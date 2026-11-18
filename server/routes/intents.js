// /api/intents: intent cards of the 'intents' interaction mode. The server owns them, next to the turns:
// session.rounds[round].intents = [{ id, text, active, transcript, createdAt, updatedAt, createdAfterTurn,
// annotations: [{ text, before, after, at }], sentIn: [turn n] }].
//
//   POST /api/intents/start         { round }         the round starts from the task's starting draft
//   POST /api/intents/extract       { round, text }   spoken comment → new intents (may be none)
//   POST /api/intents/:id/annotate  { round, text }   spoken annotation → the intent, rewritten
//   PUT  /api/intents/:id           { round, active } switch an intent on or off
//
// The starting draft (`scaffold` in data/tasks.json; for the practice round tutorial.practice.intents.task
// in the strings file) is a generic outline of the task without any choices made. It is stored as turn 1
// with kind 'scaffold' and becomes the first "current draft"; no LLM call is involved.
// The LLM sees the prompt from config.ai.intents, the latest draft (to resolve "that part") and the
// spoken text. Never the task or the situation (only what the starting draft says). Sending the active intents to the AI is /api/chat with intentIds.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { ROOT } from '../config/load.js';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

const MAX_CHARS = 4000;
const MAX_INTENTS = 60;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: { intents: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } },
  required: ['intents'],
  additionalProperties: false,
};
const ANNOTATE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

// The draft the participant is working on: the latest finished response of the round.
export const latestDraft = (roundData) => [...(roundData?.turns ?? [])].reverse().find((t) => t.status === 'done')?.response ?? '';

export function intentRoutes(app) {
  const { config, env, store, logger, ai, mock, tasksById } = app;
  const r = Router();
  // The practice round's starting draft lives in the strings file next to the practice task.
  let practiceScaffold = '';
  import(pathToFileURL(path.join(ROOT, 'content', `strings.${config.study.locale}.js`)).href)
    .then((m) => { practiceScaffold = m.default?.tutorial?.practice?.intents?.task?.scaffold ?? ''; })
    .catch(() => {});
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });

  // Validates round and text; returns { key, roundData, text } or sends the error.
  function parse(req, res, { needText = true } = {}) {
    const session = req.study;
    const round = req.body?.round;
    if (!Number.isInteger(round) || round < 0 || round > session.plan.length) { res.status(400).json({ error: 'bad_round' }); return null; }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (needText && !text) { res.status(400).json({ error: 'empty' }); return null; }
    if (text.length > MAX_CHARS) { res.status(413).json({ error: 'too_long' }); return null; }
    const key = String(round);
    const taskId = round === 0 ? 'practice' : session.plan[round - 1];
    // Attached to the session right away, so parallel requests of the same round share one object.
    const roundData = (session.rounds[key] ??= { taskId, turns: [] });
    roundData.intents ??= [];
    return { round, key, roundData, text };
  }

  const fail = (log, res, route, e) => {
    const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
    log.write('server.error', { route, error, detail: e.message });
    res.status(502).json({ error });
  };

  // Starts the round from the starting draft. Does nothing if the round already has turns (a reload, or
  // the round was started in another mode) or the task has no starting draft.
  r.post('/start', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { round, key, roundData } = p;
    const first = roundData.turns[0];
    if (first) return res.json({ turn: first.kind === 'scaffold' ? first : null });
    const scaffold = (round === 0 ? practiceScaffold : tasksById.get(roundData.taskId)?.scaffold ?? '').trim();
    if (!scaffold) return res.json({ turn: null });
    const now = new Date().toISOString();
    const turn = { n: 1, kind: 'scaffold', transcript: '', response: scaffold, status: 'done', sentAt: now, respondedAt: now };
    roundData.turns.push(turn);
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    logger.forSession(req.study, round).write('server.scaffold.shown', { turn: 1, chars: scaffold.length, text: scaffold });
    res.json({ turn });
  });

  r.post('/extract', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, text } = p;
    if (roundData.intents.length >= MAX_INTENTS) return res.status(409).json({ error: 'too_many_intents' });
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    const started = Date.now();
    try {
      const out = await service.structured({
        kind: 'extractIntents',
        instructions: config.ai.intents.extractPrompt,
        input: [{ role: 'user', content: `Current draft:\n${latestDraft(roundData)}\n\nComment:\n${text}` }],
        schema: EXTRACT_SCHEMA,
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const now = new Date().toISOString();
      const doneTurns = roundData.turns.filter((t) => t.status === 'done').length;
      let next = roundData.intents.reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0);
      const added = (out.data?.intents ?? [])
        .map((x) => String(x?.text ?? '').trim()).filter(Boolean).slice(0, 8)
        .map((t) => ({ id: `i${++next}`, text: t, active: true, transcript: text, createdAt: now, updatedAt: now, createdAfterTurn: doneTurns, annotations: [], sentIn: [] }));
      roundData.intents.push(...added);
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.intents.extracted', {
        latencyMs: Date.now() - started, transcript: text, intents: added.map(({ id, text: t }) => ({ id, text: t })),
        usage: out.usage ?? null, mock: service === mock || undefined,
      });
      res.json({ intents: added, mock: service === mock || undefined });
    } catch (e) {
      fail(log, res, '/api/intents/extract', e);
    }
  });

  r.post('/:id/annotate', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, text } = p;
    const intent = roundData.intents.find((x) => x.id === req.params.id);
    if (!intent) return res.status(404).json({ error: 'no_intent' });
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    const started = Date.now();
    try {
      const out = await service.structured({
        kind: 'annotateIntent',
        instructions: config.ai.intents.annotatePrompt,
        input: [{ role: 'user', content: `Current draft:\n${latestDraft(roundData)}\n\nIntent:\n${intent.text}\n\nAnnotation:\n${text}` }],
        schema: ANNOTATE_SCHEMA,
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const after = String(out.data?.text ?? '').trim() || intent.text;
      const before = intent.text;
      const now = new Date().toISOString();
      Object.assign(intent, { text: after, updatedAt: now });
      intent.annotations.push({ text, before, after, at: now });
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.intent.annotated', {
        id: intent.id, latencyMs: Date.now() - started, annotation: text, before, after,
        usage: out.usage ?? null, mock: service === mock || undefined,
      });
      res.json({ intent, mock: service === mock || undefined });
    } catch (e) {
      fail(log, res, `/api/intents/${intent.id}/annotate`, e);
    }
  });

  r.put('/:id', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { key, roundData } = p;
    const intent = roundData.intents.find((x) => x.id === req.params.id);
    if (!intent) return res.status(404).json({ error: 'no_intent' });
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'bad_active' });
    intent.active = req.body.active;
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    res.json({ intent });
  });

  return r;
}
