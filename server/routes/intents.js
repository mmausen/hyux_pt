// /api/intents: intent cards of the 'intents' interaction mode. The server owns them, next to the turns:
// session.rounds[round].intents = [{ id, topic, text, reason, quotes, active, transcript, createdAt, updatedAt,
// createdAfterTurn, annotations: [{ text, before, after, reasonBefore, reasonAfter, at }],
// changes: [{ at, cause, before, after }], sentIn: [turn n] }].
// Intents are the building blocks of the text. text says what the text should do, reason why the
// participant wants it ('' if they gave none), quotes the participant's own words it comes from, topic the
// part of the text it shapes (a key of config.ai.intents.topics, or a name the participant gave).
// Intents that were merged into another one, taken back by voice or deleted move to
// session.rounds[round].removedIntents (with mergedInto / removedBy and removedAt), so the log keeps them.
//
//   POST   /api/intents/start          { round }         the round starts from the task's starting draft
//   POST   /api/intents/synthesize     { round, text }   spoken comment + current intents + task → updated set
//   POST   /api/intents/:id/annotate   { round, text }   spoken annotation → the intent, rewritten
//   PUT    /api/intents/:id            { round, active } switch an intent on or off
//   DELETE /api/intents/:id            { round }         delete an intent
//
// The starting draft (`scaffold` in data/tasks.json; for the practice round tutorial.practice.intents.task
// in the strings file) is a generic outline of the task without any choices made. It is stored as turn 1
// with kind 'scaffold'; no LLM call is involved.
// Synthesis: the LLM gets config.ai.intents.synthesizePrompt, the task and situation, the topics, the
// latest draft (to resolve "that part"), the active intents and the comment, and returns the whole updated
// set of active intents. Intents that are off stay as they are. Writing the text from the active intents is
// /api/chat with intentIds.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { ROOT } from '../config/load.js';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

const MAX_CHARS = 4000;
const NO_REASON = '(none given)'; // what the annotate call sees for an intent without a reason
const clean = (v) => String(v ?? '').trim();

const SYNTHESIZE_SCHEMA = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mergedFrom: { type: 'array', items: { type: 'string' } },
          topic: { type: 'string' },
          text: { type: 'string' },
          reason: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['id', 'mergedFrom', 'topic', 'text', 'reason', 'quote'],
        additionalProperties: false,
      },
    },
    removed: { type: 'array', items: { type: 'string' } },
  },
  required: ['intents', 'removed'],
  additionalProperties: false,
};
const ANNOTATE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, reason: { type: 'string' } },
  required: ['text', 'reason'],
  additionalProperties: false,
};

// The draft the participant is working on: the latest finished response of the round.
export const latestDraft = (roundData) => [...(roundData?.turns ?? [])].reverse().find((t) => t.status === 'done')?.response ?? '';
// The draft every version is written from: the starting draft, or (a task without one) the first response.
export const baseDraft = (roundData) => (roundData?.turns ?? []).find((t) => t.status === 'done')?.response ?? '';
// Quotes of an intent; intents stored before the synthesis have a single quote.
export const quotesOf = (x) => (Array.isArray(x.quotes) ? x.quotes : x.quote ? [x.quote] : []);

// The topic as stored: a configured key (matched without regard to case, also by its label) or the
// participant's own name for it, shortened.
export function topicKey(config, raw) {
  const v = clean(raw);
  const found = config.ai.intents.topics.find((x) => x.key.toLowerCase() === v.toLowerCase() || x.label.toLowerCase() === v.toLowerCase());
  if (found) return found.key;
  return v.split(/\s+/).slice(0, 3).join(' ').slice(0, 40);
}

// Brings the model's answer into the stored intents. sentIds: the intents the model saw (active at the
// start). Returns what changed, by id. An intent the model leaves out without merging or removing it stays
// as it is, so nothing the participant said is lost by an omission.
export function reconcile({ config, roundData, data, sentIds, transcript, now }) {
  const live = roundData.intents;
  const byId = new Map(live.map((x) => [x.id, x]));
  const claimed = new Set();
  const changes = { added: [], updated: [], merged: [], removed: [] };
  const doneTurns = roundData.turns.filter((t) => t.status === 'done').length;
  let next = [...live, ...(roundData.removedIntents ?? [])].reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
  const archive = (x, extra) => {
    roundData.removedIntents = [...(roundData.removedIntents ?? []), { ...x, ...extra, removedAt: now }];
    roundData.intents = roundData.intents.filter((y) => y !== x);
  };
  const free = (id) => sentIds.has(id) && !claimed.has(id) && byId.has(id);
  const items = (data?.intents ?? []).map((x) => ({
    id: clean(x?.id), mergedFrom: Array.isArray(x?.mergedFrom) ? x.mergedFrom.map(clean) : [],
    topic: topicKey(config, x?.topic), text: clean(x?.text), reason: clean(x?.reason), quote: clean(x?.quote),
  })).filter((x) => x.text).slice(0, config.ai.intents.maxIntents + 4);

  for (const item of items) {
    // An intent the participant switched off is not shown to the model; an answer that names it anyway
    // leaves it as it is.
    if (item.id && byId.has(item.id) && !sentIds.has(item.id)) continue;
    let target = free(item.id) ? byId.get(item.id) : null;
    const absorbed = item.mergedFrom.filter((id) => id !== target?.id && free(id));
    if (!target && absorbed.length) target = byId.get(absorbed.shift());
    if (target) {
      claimed.add(target.id);
      const before = { topic: target.topic ?? '', text: target.text, reason: target.reason ?? '' };
      const after = { topic: item.topic || before.topic, text: item.text, reason: item.reason };
      target.quotes = quotesOf(target);
      delete target.quote;
      if (item.quote && !target.quotes.includes(item.quote)) target.quotes.push(item.quote);
      for (const id of absorbed) {
        claimed.add(id);
        const x = byId.get(id);
        for (const q of quotesOf(x)) if (!target.quotes.includes(q)) target.quotes.push(q);
        archive(x, { mergedInto: target.id });
        changes.merged.push({ id, into: target.id });
      }
      if (absorbed.length || after.topic !== before.topic || after.text !== before.text || after.reason !== before.reason) {
        Object.assign(target, after, { updatedAt: now });
        target.changes = [...(target.changes ?? []), { at: now, cause: absorbed.length ? 'merge' : 'comment', before, after, transcript }];
        changes.updated.push(target.id);
      }
    } else {
      const x = {
        id: `i${++next}`, topic: item.topic, text: item.text, reason: item.reason, quotes: [item.quote || transcript], active: true,
        transcript, createdAt: now, updatedAt: now, createdAfterTurn: doneTurns, annotations: [], changes: [], sentIn: [],
      };
      roundData.intents.push(x);
      changes.added.push(x.id);
    }
  }
  for (const id of (data?.removed ?? []).map(clean)) {
    if (!free(id)) continue;
    claimed.add(id);
    archive(byId.get(id), { removedBy: 'comment', transcript });
    changes.removed.push(id);
  }
  return changes;
}

export function intentRoutes(app) {
  const { config, env, store, logger, ai, mock, tasksById } = app;
  const r = Router();
  // The practice round's task and starting draft live in the strings file.
  let practiceTask = null;
  import(pathToFileURL(path.join(ROOT, 'content', `strings.${config.study.locale}.js`)).href)
    .then((m) => { practiceTask = m.default?.tutorial?.practice?.intents?.task ?? null; })
    .catch(() => {});
  const taskOf = (round, roundData) => (round === 0 ? practiceTask : tasksById.get(roundData.taskId)) ?? {};
  // One synthesis at a time per round: each one starts from the result of the one before.
  const queues = new Map();
  const serial = (key, fn) => {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  };
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
    const scaffold = String(taskOf(round, roundData).scaffold ?? '').trim();
    if (!scaffold) return res.json({ turn: null });
    const now = new Date().toISOString();
    const turn = { n: 1, kind: 'scaffold', transcript: '', response: scaffold, status: 'done', sentAt: now, respondedAt: now };
    roundData.turns.push(turn);
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    logger.forSession(req.study, round).write('server.scaffold.shown', { turn: 1, chars: scaffold.length, text: scaffold });
    res.json({ turn });
  });

  r.post('/synthesize', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, text } = p;
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    await serial(`${req.study.id}:${key}`, async () => {
      const started = Date.now();
      const task = taskOf(round, roundData);
      const { topics, maxPerTopic, maxIntents } = config.ai.intents;
      const sent = roundData.intents.filter((x) => x.active);
      const sentIds = new Set(sent.map((x) => x.id));
      const current = sent.map((x) => ({ id: x.id, topic: x.topic ?? '', text: x.text, reason: x.reason ?? '' }));
      const content = [
        `Task:\n${[task.title, task.task].filter(Boolean).join('\n')}`,
        `Situation:\n${task.situation ?? ''}`,
        `Topics:\n${topics.map((x) => `- ${x.key}: ${x.label} (${x.about})`).join('\n')}`,
        `Current draft:\n${latestDraft(roundData)}`,
        `Current intents:\n${JSON.stringify(current)}`,
        `New comment:\n${text}`,
      ].join('\n\n');
      try {
        const out = await service.structured({
          kind: 'synthesizeIntents',
          instructions: config.ai.intents.synthesizePrompt.replaceAll('{maxPerTopic}', String(maxPerTopic)).replaceAll('{maxIntents}', String(maxIntents)),
          input: [{ role: 'user', content }],
          schema: SYNTHESIZE_SCHEMA,
          maxOutputTokens: config.ai.intents.synthesizeMaxOutputTokens,
          signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
        });
        const now = new Date().toISOString();
        const changes = reconcile({ config, roundData, data: out.data, sentIds, transcript: text, now });
        await store.update(req.study, (s) => { s.rounds[key] = roundData; });
        log.write('server.intents.synthesized', {
          latencyMs: Date.now() - started, transcript: text, changes,
          before: current, after: roundData.intents.filter((x) => x.active).map(({ id, topic, text: t, reason }) => ({ id, topic, text: t, reason })),
          usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
        });
        res.json({ intents: roundData.intents, changes, mock: service === mock || undefined });
      } catch (e) {
        fail(log, res, '/api/intents/synthesize', e);
      }
    });
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
        input: [{ role: 'user', content: `Current draft:\n${latestDraft(roundData)}\n\nIntent:\n${intent.text}\n\nReason:\n${intent.reason || NO_REASON}\n\nAnnotation:\n${text}` }],
        schema: ANNOTATE_SCHEMA,
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const after = clean(out.data?.text) || intent.text;
      const before = intent.text;
      const reasonBefore = intent.reason ?? '';
      const reasonAfter = clean(out.data?.reason).replace(NO_REASON, '');
      const now = new Date().toISOString();
      Object.assign(intent, { text: after, reason: reasonAfter, updatedAt: now });
      intent.annotations.push({ text, before, after, reasonBefore, reasonAfter, at: now });
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.intent.annotated', {
        id: intent.id, latencyMs: Date.now() - started, annotation: text, before, after, reasonBefore, reasonAfter,
        usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
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

  r.delete('/:id', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { round, key, roundData } = p;
    const intent = roundData.intents.find((x) => x.id === req.params.id);
    if (!intent) return res.status(404).json({ error: 'no_intent' });
    const now = new Date().toISOString();
    roundData.removedIntents = [...(roundData.removedIntents ?? []), { ...intent, removedBy: 'participant', removedAt: now }];
    roundData.intents = roundData.intents.filter((x) => x !== intent);
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    logger.forSession(req.study, round).write('server.intent.deleted', { id: intent.id, topic: intent.topic ?? '', text: intent.text, reason: intent.reason ?? '', active: intent.active });
    res.json({ ok: true });
  });

  return r;
}
