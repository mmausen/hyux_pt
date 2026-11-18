// /api/compare: the 'compare' interaction mode. Two similar versions of the text stand side by side; the
// participant picks the one they prefer and says what they like most about it. That updates a hidden
// preference profile, the rejected version leaves, and a new one, written from the profile and the pick,
// takes its place. Round by round the profile gets richer and the versions converge until one is accepted.
//
//   POST /api/compare/start   { round }                         the current pair (writes the first pair once)
//   POST /api/compare/next    { round, chosenId, text }         pick + spoken annotation → profile, new pair
//   POST /api/compare/accept  { round, versionId }              the participant accepts a version as final
//
// Stored with the session (rounds[round].compare):
//   { versions: [{ id, n, text, origin: 'initial' | 'challenger', step, differences, createdAt }],
//     pair: { left, right } (version ids), step, profile: [statements], picks: [{ step, chosen, rejected,
//     side, annotation, profileBefore, profileAfter, at }], accepted: { versionId, step, at } | null,
//     generating: ISO time | null }
// The browser only ever gets the pair's texts (publicState): the profile and the differences stay hidden
// (they are logged). The model sees the prompts in config.ai.compare, the outline (scaffold), the
// situation (if ai.compare.includeSituation), and the versions and annotations. Never the task itself.
import { Router } from 'express';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { cleanResponse } from '../../public/js/core/cleanResponse.js';

const MAX_CHARS = 4000;
const clean = (v) => String(v ?? '').trim();
const text = (v) => cleanResponse(clean(v)) || clean(v);
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

const INITIAL_SCHEMA = {
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'string' }, differences: { type: 'array', items: { type: 'string' } } },
  required: ['a', 'b', 'differences'],
  additionalProperties: false,
};
const NEXT_SCHEMA = {
  type: 'object',
  properties: {
    profile: { type: 'array', items: { type: 'string' } },
    challenger: { type: 'string' },
    differences: { type: 'array', items: { type: 'string' } },
  },
  required: ['profile', 'challenger', 'differences'],
  additionalProperties: false,
};

export function publicState(c) {
  if (!c) return { versions: null, generating: false };
  const v = (id) => {
    const x = c.versions.find((y) => y.id === id);
    return x ? { id: x.id, n: x.n, text: x.text, origin: x.origin, step: x.step } : null;
  };
  const last = c.picks.at(-1);
  return {
    step: c.step,
    pair: c.pair ? { left: v(c.pair.left), right: v(c.pair.right) } : null,
    kept: last ? last.chosen : null, // the version kept from the round before
    picks: c.picks.length,
    accepted: c.accepted?.versionId ?? null,
    generating: Boolean(c.generating),
  };
}

export function compareRoutes(app) {
  const { config, env, store, logger, ai, mock, tasksById } = app;
  const r = Router();
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });
  // A generation that started longer ago than this was lost (e.g. a server restart) and may start again.
  const staleMs = (config.ai.timeoutSeconds + 15) * 1000;
  const busy = (c) => c?.generating && Date.now() - Date.parse(c.generating) < staleMs;

  function parse(req, res) {
    const session = req.study;
    const round = req.body?.round;
    if (!Number.isInteger(round) || round < 0 || round > session.plan.length) { res.status(400).json({ error: 'bad_round' }); return null; }
    const key = String(round);
    const taskId = round === 0 ? 'practice' : session.plan[round - 1];
    const roundData = (session.rounds[key] ??= { taskId, turns: [] });
    const task = tasksById.get(roundData.taskId);
    return { round, key, roundData, task };
  }

  // What every call gets about the text: the outline and, if configured, the situation.
  function context(task) {
    const parts = [];
    if (config.ai.compare.includeSituation && task?.situation) parts.push(`Situation:\n${task.situation}`);
    if (task?.scaffold) parts.push(`Outline:\n${task.scaffold}`);
    return parts.join('\n\n');
  }

  const call = (service, kind, instructions, content, schema, extra = {}) => service.structured({
    kind,
    instructions,
    input: [{ role: 'user', content }],
    schema,
    maxOutputTokens: config.ai.compare.maxOutputTokens,
    hedgeAfterSeconds: 0, // long calls: no second request
    signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
    ...extra,
  });

  const save = (req, key, roundData) => store.update(req.study, (s) => { s.rounds[key] = roundData; });
  const fail = (log, res, route, e) => {
    const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
    log.write('server.error', { route, error, detail: e.message });
    res.status(502).json({ error });
  };

  r.post('/start', requireSession(store), async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, task } = p;
    const c = roundData.compare;
    if (c?.pair || busy(c)) return res.json(publicState(c));
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    roundData.compare = { versions: [], pair: null, step: 0, profile: [], picks: [], accepted: null, generating: new Date().toISOString() };
    await save(req, key, roundData);
    const started = Date.now();
    try {
      const out = await call(service, 'compareInitial', config.ai.compare.initialPrompt, context(task), INITIAL_SCHEMA);
      const a = text(out.data?.a);
      const b = text(out.data?.b);
      if (!a || !b) throw new Error('The model returned an empty version');
      const now = new Date().toISOString();
      const differences = list(out.data?.differences);
      const cmp = roundData.compare;
      cmp.versions.push({ id: 'v1', n: 1, text: a, origin: 'initial', step: 1, differences, createdAt: now }, { id: 'v2', n: 2, text: b, origin: 'initial', step: 1, differences, createdAt: now });
      Object.assign(cmp, { pair: { left: 'v1', right: 'v2' }, step: 1, generating: null });
      await save(req, key, roundData);
      log.write('server.compare.initial', {
        latencyMs: Date.now() - started, a, b, differences, usage: out.usage ?? null, mock: service === mock || undefined,
      });
      res.json(publicState(cmp));
    } catch (e) {
      roundData.compare = null;
      await save(req, key, roundData);
      fail(log, res, '/api/compare/start', e);
    }
  });

  r.post('/next', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, task } = p;
    const c = roundData.compare;
    if (!c?.pair) return res.status(409).json({ error: 'no_pair' });
    if (busy(c)) return res.status(409).json({ error: 'busy' });
    const annotation = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!annotation) return res.status(400).json({ error: 'empty' });
    if (annotation.length > MAX_CHARS) return res.status(413).json({ error: 'too_long' });
    const chosenId = req.body?.chosenId;
    const side = c.pair.left === chosenId ? 'left' : c.pair.right === chosenId ? 'right' : null;
    if (!side) return res.status(400).json({ error: 'bad_choice' });
    const rejectedId = side === 'left' ? c.pair.right : c.pair.left;
    const chosen = c.versions.find((x) => x.id === chosenId);
    const rejected = c.versions.find((x) => x.id === rejectedId);

    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    c.generating = new Date().toISOString();
    await save(req, key, roundData);
    const started = Date.now();
    const profileBefore = [...c.profile];
    try {
      const content = [
        context(task),
        `Round: ${c.step + 1}`,
        `Profile so far:\n${profileBefore.length ? profileBefore.map((x) => `- ${x}`).join('\n') : '(empty)'}`,
        `Picked version:\n${chosen.text}`,
        `Rejected version:\n${rejected.text}`,
        `What they like most about the picked version:\n${annotation}`,
      ].filter(Boolean).join('\n\n');
      const out = await call(service, 'compareNext', config.ai.compare.nextPrompt, content, NEXT_SCHEMA, { context: { annotation, chosen: chosen.text, profile: profileBefore, step: c.step + 1 } });
      const challenger = text(out.data?.challenger);
      if (!challenger) throw new Error('The model returned an empty version');
      const profile = list(out.data?.profile).slice(0, 20);
      const differences = list(out.data?.differences);
      const now = new Date().toISOString();
      const n = c.versions.length + 1;
      const version = { id: `v${n}`, n, text: challenger, origin: 'challenger', step: c.step + 1, differences, createdAt: now };
      c.versions.push(version);
      c.picks.push({ step: c.step, chosen: chosenId, rejected: rejectedId, side, annotation, profileBefore, profileAfter: profile, at: now });
      c.profile = profile;
      c.pair = side === 'left' ? { left: chosenId, right: version.id } : { left: version.id, right: chosenId };
      c.step += 1;
      c.generating = null;
      await save(req, key, roundData);
      log.write('server.compare.next', {
        step: c.step, latencyMs: Date.now() - started, chosen: chosenId, rejected: rejectedId, side, annotation,
        profileBefore, profileAfter: profile, challenger: version.id, text: challenger, differences, usage: out.usage ?? null, mock: service === mock || undefined,
      });
      res.json(publicState(c));
    } catch (e) {
      c.generating = null;
      await save(req, key, roundData);
      fail(log, res, '/api/compare/next', e);
    }
  });

  r.post('/accept', requireSession(store), async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData } = p;
    const c = roundData.compare;
    const versionId = req.body?.versionId;
    if (!c?.pair || ![c.pair.left, c.pair.right].includes(versionId)) return res.status(400).json({ error: 'bad_version' });
    const version = c.versions.find((x) => x.id === versionId);
    c.accepted = { versionId, step: c.step, at: new Date().toISOString() };
    await save(req, key, roundData);
    logger.forSession(req.study, round).write('server.compare.accepted', { versionId, step: c.step, picks: c.picks.length, profile: c.profile, text: version.text });
    res.json(publicState(c));
  });

  return r;
}
