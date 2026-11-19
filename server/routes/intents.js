// /api/intents: intent cards of the 'intents' interaction mode. The server owns them, next to the turns:
// session.rounds[round].intents = [{ id, group, text, reason, nuance, quotes, active, transcript, createdAt,
// updatedAt, createdAfterTurn, annotations: [{ text, before, after, reasonBefore, reasonAfter, at }],
// changes: [{ at, cause, before, after, transcript? }], sentIn: [turn n] }].
// Intents are the building blocks of the text. text says what the text should do, reason why the
// participant wants it ('' if they gave none), nuance a short qualifier when one is needed (for example
// "implicit"), quotes the participant's own words it comes from, group the part of the text it shapes.
// session.rounds[round].groups: the groups in the order they shape the text; .accents: group → accent
// colour, fixed once given. Intents that were merged, taken back, deleted or undone move to
// session.rounds[round].removedIntents (with mergedInto / removedBy and removedAt).
//
// The work happens in rounds: collect, then structure, then generate.
//   Collect: each recording adds intents. It changes existing cards only when it clearly revises them
//   (and may then merge them); the last recording, or the last change of a card by voice, can be undone.
//   Structure and generate: Write Version (/api/chat with intentIds) first brings all active intents into
//   one plan (structureIntents below: accumulate, combine on a spectrum, keep the groups stable), then
//   writes the text from the starting draft and that plan.
//
//   POST   /api/intents/start          { round }         the round starts from the task's starting draft
//   POST   /api/intents/collect        { round, text }   spoken comment → intents added (or clearly revised)
//   POST   /api/intents/undo           { round, token }  undo the last recording or change by voice
//   POST   /api/intents/:id/annotate   { round, text }   spoken annotation → the intent, rewritten
//   PUT    /api/intents/:id            { round, active } switch an intent on or off
//   DELETE /api/intents/:id            { round }         delete an intent
//
// The starting draft (`scaffold` in data/tasks.json; for the practice round tutorial.practice.intents.task
// in the strings file) is a generic outline of the task without any choices made. It is stored as turn 1
// with kind 'scaffold'; no LLM call is involved.
// The task and the situation reach the collect and structure calls (to understand and place what the
// participant says), never the call that writes the text. Intents that are off are not shown to the
// model and stay as they are.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { ROOT } from '../config/load.js';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

const MAX_CHARS = 4000;
const MAX_LIVE = 60;
const NO_REASON = '(none given)'; // what the annotate call sees for an intent without a reason
const clean = (v) => String(v ?? '').trim();
const ids = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
// Accent colours (--sapAccentColor1…10), given to groups in this order.
const ACCENTS = [6, 3, 1, 7, 8, 5, 9, 4, 2, 10];

const ITEM = { group: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' }, nuance: { type: 'string' } };
const COLLECT_SCHEMA = {
  type: 'object',
  properties: {
    added: {
      type: 'array',
      items: { type: 'object', properties: { ...ITEM, quote: { type: 'string' } }, required: ['group', 'text', 'reason', 'nuance', 'quote'], additionalProperties: false },
    },
    revised: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, mergedFrom: { type: 'array', items: { type: 'string' } }, ...ITEM, quote: { type: 'string' } },
        required: ['id', 'mergedFrom', 'group', 'text', 'reason', 'nuance', 'quote'],
        additionalProperties: false,
      },
    },
    removed: { type: 'array', items: { type: 'string' } },
  },
  required: ['added', 'revised', 'removed'],
  additionalProperties: false,
};
const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    groups: { type: 'array', items: { type: 'string' } },
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, mergedFrom: { type: 'array', items: { type: 'string' } }, ...ITEM },
        required: ['id', 'mergedFrom', 'group', 'text', 'reason', 'nuance'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups', 'intents'],
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
// Quotes of an intent; intents stored before the quotes list have a single quote.
export const quotesOf = (x) => (Array.isArray(x.quotes) ? x.quotes : x.quote ? [x.quote] : []);
// The group of an intent; intents stored before the groups have a topic.
export const groupOf = (x) => clean(x.group ?? x.topic);

// The practice round's task (with its starting draft) lives in the strings file.
let practiceTask = null;
function loadPractice(config) {
  import(pathToFileURL(path.join(ROOT, 'content', `strings.${config.study.locale}.js`)).href)
    .then((m) => { practiceTask = m.default?.tutorial?.practice?.intents?.task ?? null; })
    .catch(() => {});
}
export const taskFor = (app, round, roundData) => (round === 0 ? practiceTask : app.tasksById.get(roundData.taskId)) ?? {};

// The group name as stored: an existing group (matched without regard to case), else the name, shortened.
function groupName(roundData, raw) {
  const v = clean(raw).replace(/\s+/g, ' ').slice(0, 40);
  return (roundData.groups ?? []).find((g) => g.toLowerCase() === v.toLowerCase()) ?? v;
}
// Gives every group in use a place in the order and an accent colour; order: the model's order first.
function settleGroups(roundData, order = null) {
  const used = [...new Set(roundData.intents.map(groupOf).filter(Boolean))];
  const known = order ?? roundData.groups ?? [];
  roundData.groups = [...known.filter((g) => used.includes(g)), ...used.filter((g) => !known.includes(g))];
  roundData.accents ??= {};
  for (const g of roundData.groups) {
    if (!(g in roundData.accents)) roundData.accents[g] = ACCENTS[Object.keys(roundData.accents).length % ACCENTS.length];
  }
}
export const groupsView = (roundData) => ({ groups: roundData.groups ?? [], accents: roundData.accents ?? {} });

const fieldsOf = (x) => ({ group: groupOf(x), text: x.text, reason: x.reason ?? '', nuance: x.nuance ?? '' });
const same = (a, b) => a.group === b.group && a.text === b.text && a.reason === b.reason && a.nuance === b.nuance;

// Brings the model's answer into the stored intents. items: [{ id, mergedFrom, group, text, reason, nuance,
// quote }]; an item with an id the model saw updates that intent, mergedFrom names intents it absorbs, an
// item without one is a new intent. removed: ids the participant clearly took back. sentIds: the intents
// the model saw (active at the start). An intent the model leaves out stays as it is, so nothing the
// participant said is lost by an omission. Returns what changed and a snapshot to undo it.
export function reconcile({ roundData, items, removed = [], sentIds, transcript, cause, now }) {
  const byId = new Map(roundData.intents.map((x) => [x.id, x]));
  const claimed = new Set();
  const changes = { added: [], updated: [], merged: [], removed: [] };
  const before = []; // intents as they were before this change, with their place in the list
  const remember = (x) => { if (!before.some((b) => b.id === x.id)) before.push({ ...structuredClone(x), index: roundData.intents.indexOf(x) }); };
  const doneTurns = roundData.turns.filter((t) => t.status === 'done').length;
  let next = [...roundData.intents, ...(roundData.removedIntents ?? [])].reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
  const archive = (x, extra) => {
    roundData.removedIntents = [...(roundData.removedIntents ?? []), { ...x, ...extra, removedAt: now }];
    roundData.intents = roundData.intents.filter((y) => y !== x);
  };
  const free = (id) => sentIds.has(id) && !claimed.has(id) && byId.has(id);

  for (const raw of items) {
    const item = { id: clean(raw?.id), mergedFrom: ids(raw?.mergedFrom), group: groupName(roundData, raw?.group), text: clean(raw?.text), reason: clean(raw?.reason), nuance: clean(raw?.nuance).slice(0, 40), quote: clean(raw?.quote) };
    if (!item.text) continue;
    // An intent the participant switched off is not shown to the model; an answer that names it anyway
    // leaves it as it is.
    if (item.id && byId.has(item.id) && !sentIds.has(item.id)) continue;
    let target = free(item.id) ? byId.get(item.id) : null;
    const absorbed = item.mergedFrom.filter((id) => id !== target?.id && free(id));
    if (!target && absorbed.length) target = byId.get(absorbed.shift());
    if (!target) {
      const x = {
        id: `i${++next}`, ...fieldsOf({ ...item, group: item.group || 'Other' }), quotes: [item.quote || transcript].filter(Boolean), active: true,
        transcript, createdAt: now, updatedAt: now, createdAfterTurn: doneTurns, annotations: [], changes: [], sentIn: [],
      };
      roundData.intents.push(x);
      changes.added.push(x.id);
      continue;
    }
    claimed.add(target.id);
    const was = fieldsOf(target);
    const after = { group: item.group || was.group, text: item.text, reason: item.reason, nuance: item.nuance };
    if (!absorbed.length && same(was, after) && (!item.quote || quotesOf(target).includes(item.quote))) continue;
    remember(target);
    target.quotes = quotesOf(target);
    delete target.quote;
    delete target.topic;
    if (item.quote && !target.quotes.includes(item.quote)) target.quotes.push(item.quote);
    for (const id of absorbed) {
      claimed.add(id);
      const x = byId.get(id);
      remember(x);
      for (const q of quotesOf(x)) if (!target.quotes.includes(q)) target.quotes.push(q);
      archive(x, { mergedInto: target.id });
      changes.merged.push({ id, into: target.id });
    }
    if (absorbed.length || !same(was, after)) {
      Object.assign(target, after, { updatedAt: now });
      target.changes = [...(target.changes ?? []), { at: now, cause: absorbed.length ? `${cause}-merge` : cause, before: was, after: after, ...(transcript ? { transcript } : {}) }];
      changes.updated.push(target.id);
    }
  }
  for (const id of removed) {
    if (!free(id)) continue;
    claimed.add(id);
    const x = byId.get(id);
    remember(x);
    archive(x, { removedBy: cause, transcript });
    changes.removed.push(id);
  }
  return { changes, undo: { added: changes.added, before } };
}

// Puts back the intents as they were before the last recording or change by voice: intents it added go,
// intents it changed, merged or took back return. Their on/off state stays as the participant set it.
function applyUndo(roundData, undo, now) {
  for (const id of undo.added) {
    const x = roundData.intents.find((y) => y.id === id);
    if (x) {
      roundData.removedIntents = [...(roundData.removedIntents ?? []), { ...x, removedBy: 'undo', removedAt: now }];
      roundData.intents = roundData.intents.filter((y) => y !== x);
    }
  }
  for (const { index, ...b } of undo.before) {
    const cur = roundData.intents.find((y) => y.id === b.id);
    if (cur) {
      Object.assign(cur, { ...b, active: cur.active });
      if (!('topic' in b)) delete cur.topic;
    } else {
      roundData.removedIntents = (roundData.removedIntents ?? []).filter((y) => !(y.id === b.id && y.removedAt === undo.at));
      roundData.intents.splice(Math.min(index, roundData.intents.length), 0, b);
    }
  }
}

// The groups the model chooses from: those the round already has, in order, and the suggested parts with
// what each one covers. Both are always listed, so a round that has one group so far does not pull every
// new intent into it.
const groupsText = (config, roundData) => {
  const groups = roundData.groups ?? [];
  const suggested = config.ai.intents.suggestedGroups.filter((g) => !groups.some((x) => x.toLowerCase() === g.name.toLowerCase()));
  const about = (name) => config.ai.intents.suggestedGroups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.about;
  return [
    groups.length ? `Groups the text has so far, in order:\n${groups.map((g) => `- ${g}${about(g) ? `: ${about(g)}` : ''}`).join('\n')}` : 'Groups the text has so far: none.',
    suggested.length ? `Other parts a text like this has (use one when the intent belongs there):\n${suggested.map((g) => `- ${g.name}: ${g.about}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
};
const intentsJson = (list, newIds = null) => JSON.stringify(list.map((x) => ({
  id: x.id, group: groupOf(x), text: x.text, reason: x.reason ?? '', nuance: x.nuance ?? '', ...(newIds ? { new: newIds.has(x.id) } : {}),
})));
const taskText = (task) => `Task:\n${[task.title, task.task].filter(Boolean).join('\n')}\n\nSituation:\n${task.situation ?? ''}`;

// Structure (Write Version): all active intents → one plan for the next version. Returns { changes } or
// throws; the caller then writes from the intents as they are.
export async function structureIntents({ config, service, roundData, task, signal }) {
  const active = roundData.intents.filter((x) => x.active);
  const lastN = [...roundData.turns].reverse().find((t) => t.status === 'done' && t.intents)?.n ?? 0;
  const newIds = new Set(active.filter((x) => !x.sentIn?.includes(lastN) || !lastN).map((x) => x.id));
  const content = [taskText(task), groupsText(config, roundData), `Intents that are on:\n${intentsJson(active, newIds)}`].join('\n\n');
  const out = await service.structured({
    kind: 'structureIntents',
    instructions: config.ai.intents.structurePrompt,
    input: [{ role: 'user', content }],
    schema: STRUCTURE_SCHEMA,
    maxOutputTokens: config.ai.intents.structureMaxOutputTokens,
    signal,
  });
  const now = new Date().toISOString();
  const before = active.map((x) => ({ id: x.id, ...fieldsOf(x) }));
  const { changes } = reconcile({ roundData, items: out.data?.intents ?? [], sentIds: new Set(active.map((x) => x.id)), transcript: '', cause: 'structure', now });
  settleGroups(roundData, ids(out.data?.groups).map((g) => groupName(roundData, g)));
  roundData.undo = null; // a new version starts a new round: what came before it cannot be undone
  return { changes, before, usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt };
}

export function intentRoutes(app) {
  const { config, env, store, logger, ai, mock } = app;
  const r = Router();
  loadPractice(config);
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });
  // One change at a time per round: each one starts from the result of the one before.
  const queues = new Map();
  const serial = (key, fn) => {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  };
  const view = (roundData) => ({ intents: roundData.intents, ...groupsView(roundData) });
  // Keeps what is needed to undo this change (only the last one can be undone).
  const keepUndo = (roundData, kind, undo, now) => {
    if (!undo.added.length && !undo.before.length) return null;
    roundData.undo = { token: randomUUID(), kind, at: now, ...undo };
    return roundData.undo.token;
  };

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
    const scaffold = String(taskFor(app, round, roundData).scaffold ?? '').trim();
    if (!scaffold) return res.json({ turn: null });
    const now = new Date().toISOString();
    const turn = { n: 1, kind: 'scaffold', transcript: '', response: scaffold, status: 'done', sentAt: now, respondedAt: now };
    roundData.turns.push(turn);
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    logger.forSession(req.study, round).write('server.scaffold.shown', { turn: 1, chars: scaffold.length, text: scaffold });
    res.json({ turn });
  });

  // Collect: the comment becomes new intents; existing ones change only on a clear revision.
  r.post('/collect', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, text } = p;
    if (roundData.intents.length >= MAX_LIVE) return res.status(409).json({ error: 'too_many_intents' });
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    await serial(`${req.study.id}:${key}`, async () => {
      const started = Date.now();
      const active = roundData.intents.filter((x) => x.active);
      const content = [
        taskText(taskFor(app, round, roundData)),
        groupsText(config, roundData),
        `Current draft:\n${latestDraft(roundData)}`,
        `Current intents:\n${intentsJson(active)}`,
        `New comment:\n${text}`,
      ].join('\n\n');
      try {
        const out = await service.structured({
          kind: 'collectIntents',
          instructions: config.ai.intents.collectPrompt,
          input: [{ role: 'user', content }],
          schema: COLLECT_SCHEMA,
          maxOutputTokens: config.ai.intents.collectMaxOutputTokens,
          signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
        });
        const now = new Date().toISOString();
        const items = [...(out.data?.revised ?? []), ...(out.data?.added ?? []).map((x) => ({ ...x, id: '', mergedFrom: [] }))].slice(0, 12);
        const { changes, undo } = reconcile({ roundData, items, removed: ids(out.data?.removed), sentIds: new Set(active.map((x) => x.id)), transcript: text, cause: 'comment', now });
        settleGroups(roundData);
        const undoToken = keepUndo(roundData, 'recording', undo, now);
        await store.update(req.study, (s) => { s.rounds[key] = roundData; });
        log.write('server.intents.collected', {
          latencyMs: Date.now() - started, transcript: text, changes,
          before: undo.before.map((x) => ({ id: x.id, ...fieldsOf(x) })),
          after: roundData.intents.filter((x) => changes.added.includes(x.id) || changes.updated.includes(x.id)).map((x) => ({ id: x.id, ...fieldsOf(x) })),
          usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
        });
        res.json({ ...view(roundData), changes, undoToken, mock: service === mock || undefined });
      } catch (e) {
        fail(log, res, '/api/intents/collect', e);
      }
    });
  });

  r.post('/undo', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { round, key, roundData } = p;
    await serial(`${req.study.id}:${key}`, async () => {
      const undo = roundData.undo;
      if (!undo || undo.token !== req.body?.token) return res.status(409).json({ error: 'undo_expired' });
      const now = new Date().toISOString();
      applyUndo(roundData, undo, now);
      roundData.undo = null;
      settleGroups(roundData);
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      logger.forSession(req.study, round).write('server.intents.undone', {
        kind: undo.kind, removed: undo.added, restored: undo.before.map((x) => ({ id: x.id, ...fieldsOf(x) })),
      });
      res.json({ ...view(roundData), restored: undo.before.map((x) => x.id) });
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
    await serial(`${req.study.id}:${key}`, async () => {
      const started = Date.now();
      try {
        const out = await service.structured({
          kind: 'annotateIntent',
          instructions: config.ai.intents.annotatePrompt,
          input: [{ role: 'user', content: `Current draft:\n${latestDraft(roundData)}\n\nIntent:\n${intent.text}\n\nReason:\n${intent.reason || NO_REASON}\n\nAnnotation:\n${text}` }],
          schema: ANNOTATE_SCHEMA,
          signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
        });
        const snapshot = { ...structuredClone(intent), index: roundData.intents.indexOf(intent) };
        const after = clean(out.data?.text) || intent.text;
        const before = intent.text;
        const reasonBefore = intent.reason ?? '';
        const reasonAfter = clean(out.data?.reason).replace(NO_REASON, '');
        const now = new Date().toISOString();
        Object.assign(intent, { text: after, reason: reasonAfter, updatedAt: now });
        intent.annotations = [...(intent.annotations ?? []), { text, before, after, reasonBefore, reasonAfter, at: now }];
        const undoToken = keepUndo(roundData, 'annotation', { added: [], before: [snapshot] }, now);
        await store.update(req.study, (s) => { s.rounds[key] = roundData; });
        log.write('server.intent.annotated', {
          id: intent.id, latencyMs: Date.now() - started, annotation: text, before, after, reasonBefore, reasonAfter,
          usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
        });
        res.json({ intent, undoToken, mock: service === mock || undefined });
      } catch (e) {
        fail(log, res, `/api/intents/${intent.id}/annotate`, e);
      }
    });
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
    settleGroups(roundData);
    await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    logger.forSession(req.study, round).write('server.intent.deleted', { id: intent.id, ...fieldsOf(intent), active: intent.active });
    res.json({ ok: true, ...groupsView(roundData) });
  });

  return r;
}
