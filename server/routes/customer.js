// /api/customer: the 'customer' interaction mode ("Customer in the Room"). The AI plays the reader of the
// draft (a customer persona) and only reacts to it; the participant decides what to change. The server
// owns the state, next to the turns:
//
//   session.rounds[round].customer = {
//     personaId,                         persona for the next reactions (null = the first of the task)
//     asks:      [{ n, personaId, persona: { id, name, role }, turn, status: 'pending'|'done'|'failed',
//                   askedAt, answeredAt, latencyMs, error, reactionIds }],
//     reactions: [{ id, ask, turn, personaId, personaName, quote, start, text, tone, active,
//                   responses: [{ text, at }], createdAt, sentIn: [turn n] }],
//     notes:     [{ id, text, active, createdAt, createdAfterTurn, sentIn: [turn n] }],
//   }
//
// turn is the draft version (turn n) a reaction was made on; quote the exact passage of that draft (start:
// its position, -1 if the model's quote could not be found in the draft). Notes are the participant's
// general instructions, not tied to a reaction.
//
//   POST /api/customer/ask                          { round }           the customer reads the latest draft
//   PUT  /api/customer/persona                      { round, personaId } who reads next
//   POST /api/customer/reactions/:id/respond        { round, text }     the participant's spoken response
//   POST /api/customer/notes                        { round, text }     a general instruction
//   PUT  /api/customer/reactions/:id | notes/:id    { round, active }   switch on or off
//
// An ask is stored as 'pending' before the LLM call and completed even if the browser goes away, so a
// reload while the customer is reacting picks up the result (the client polls GET /api/session).
// The starting draft is /api/intents/start; sending the changes is /api/chat with { customer }.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { ROOT } from '../config/load.js';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { latestDraft } from './intents.js';

const MAX_CHARS = 4000;
const MAX_NOTES = 60;
const MAX_RESPONSES = 10;
const TONES = ['positive', 'neutral', 'negative'];
const clean = (v) => String(v ?? '').trim();

const REACTIONS_SCHEMA = {
  type: 'object',
  properties: {
    reactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string' }, text: { type: 'string' }, tone: { type: 'string', enum: TONES } },
        required: ['quote', 'text', 'tone'],
        additionalProperties: false,
      },
    },
  },
  required: ['reactions'],
  additionalProperties: false,
};

// The latest finished turn (the draft version reactions refer to).
export const latestTurn = (roundData) => [...(roundData?.turns ?? [])].reverse().find((t) => t.status === 'done') ?? null;

// Finds a quote in the draft: exactly, else ignoring case, quote marks, dashes and runs of white space
// (models now and then "fix" a typographic apostrophe). Returns the passage as it is in the draft.
export function anchor(draft, quote) {
  const q = clean(quote).replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '').replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, '').trim();
  if (!q) return { quote: clean(quote), start: -1 };
  const exact = draft.indexOf(q);
  if (exact >= 0) return { quote: q, start: exact };
  const norm = (c) => (/[“”«»]/.test(c) ? '"' : /[‘’`]/.test(c) ? "'" : /[–—]/.test(c) ? '-' : c.toLowerCase());
  // Normalized draft with a map back to positions in the original.
  let flat = '';
  const map = [];
  for (let i = 0; i < draft.length; i++) {
    if (/\s/.test(draft[i])) {
      if (flat.endsWith(' ')) continue;
      flat += ' ';
    } else flat += norm(draft[i]);
    map.push(i);
  }
  const target = [...q.replace(/\s+/g, ' ')].map(norm).join('');
  let at = flat.indexOf(target);
  // A quote with an ellipsis in the middle: its longest part.
  if (at < 0 && /\.\.\.|…/.test(q)) {
    const part = q.split(/\s*(?:\.\.\.|…)\s*/).sort((a, b) => b.length - a.length)[0];
    return part && part !== q ? anchor(draft, part) : { quote: q, start: -1 };
  }
  if (at < 0) return { quote: q, start: -1 };
  const start = map[at];
  const end = map[at + target.length - 1] + 1;
  return { quote: draft.slice(start, end), start };
}

export function customerRoutes(app) {
  const { config, env, store, logger, ai, mock, tasksById } = app;
  const r = Router();
  // The practice round's personas live in the strings file (tutorial.practice.customer.task.personas).
  let practicePersonas = [];
  import(pathToFileURL(path.join(ROOT, 'content', `strings.${config.study.locale}.js`)).href)
    .then((m) => { practicePersonas = m.default?.tutorial?.practice?.customer?.task?.personas ?? []; })
    .catch(() => {});
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });

  // Personas of a round: the task's, else one generic busy decision-maker (config.ai.customer.defaultPersona).
  const personasOf = (round, roundData) => {
    const list = round === 0 ? practicePersonas : tasksById.get(roundData.taskId)?.personas;
    return Array.isArray(list) && list.length ? list : [config.ai.customer.defaultPersona];
  };

  // Validates round (and text); returns { round, key, roundData, cust, text } or sends the error.
  function parse(req, res, { needText = false } = {}) {
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
    const cust = (roundData.customer ??= { personaId: null, asks: [], reactions: [], notes: [] });
    return { round, key, roundData, cust, text };
  }
  const save = (req, key, roundData) => store.update(req.study, (s) => { s.rounds[key] = roundData; });
  const nextId = (list, prefix) => `${prefix}${list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0) + 1}`;

  r.post('/ask', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, cust } = p;
    const turn = latestTurn(roundData);
    if (!turn?.response) return res.status(400).json({ error: 'no_draft' });
    if (roundData.turns.some((t) => t.status === 'pending')) return res.status(409).json({ error: 'busy' });
    // One ask at a time. A pending ask older than the time limit was lost (e.g. a server restart).
    const staleMs = (config.ai.timeoutSeconds + 30) * 1000;
    for (const a of cust.asks) {
      if (a.status !== 'pending') continue;
      if (Date.now() - Date.parse(a.askedAt) < staleMs) return res.status(409).json({ error: 'busy' });
      Object.assign(a, { status: 'failed', error: 'lost' });
    }
    const personas = personasOf(round, roundData);
    const persona = personas.find((x) => x.id === cust.personaId) ?? personas[0];
    const ask = {
      n: cust.asks.length + 1, personaId: persona.id, persona: { id: persona.id, name: persona.name, role: persona.role ?? '' },
      turn: turn.n, status: 'pending', askedAt: new Date().toISOString(), reactionIds: [],
    };
    cust.asks.push(ask);
    await save(req, key, roundData);

    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    log.write('server.customer.asked', { ask: ask.n, persona: persona.id, turn: turn.n });
    const started = Date.now();
    const draft = turn.response;
    try {
      // The request is not aborted when the browser disconnects: the ask is still stored, so a reload shows it.
      const out = await service.structured({
        kind: 'customerReactions',
        instructions: config.ai.customer.reactPrompt,
        input: [{ role: 'user', content: `Who you are:\n${persona.name}${persona.role ? `, ${persona.role}` : ''}. ${persona.profile ?? persona.about ?? ''}\n\nThe draft you received:\n${draft}` }],
        schema: REACTIONS_SCHEMA,
        maxOutputTokens: config.ai.customer.maxOutputTokens,
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const now = new Date().toISOString();
      let id = Number(nextId(cust.reactions, 'r').slice(1));
      const added = (out.data?.reactions ?? [])
        .map((x) => ({ ...anchor(draft, x?.quote), text: clean(x?.text), tone: TONES.includes(x?.tone) ? x.tone : 'neutral' }))
        .filter((x) => x.text)
        .slice(0, config.ai.customer.maxReactions)
        .sort((a, b) => (a.start < 0 ? Infinity : a.start) - (b.start < 0 ? Infinity : b.start))
        .map((x) => ({
          id: `r${id++}`, ask: ask.n, turn: turn.n, personaId: persona.id, personaName: persona.name,
          quote: x.quote, start: x.start, text: x.text, tone: x.tone, active: true, responses: [], createdAt: now, sentIn: [],
        }));
      cust.reactions.push(...added);
      Object.assign(ask, { status: 'done', answeredAt: now, latencyMs: Date.now() - started, reactionIds: added.map((x) => x.id), mock: service === mock || undefined });
      await save(req, key, roundData);
      log.write('server.customer.reactions', {
        ask: ask.n, persona: persona.id, turn: turn.n, latencyMs: ask.latencyMs,
        reactions: added.map(({ id: rid, tone, text, quote, start }) => ({ id: rid, tone, text, quote, found: start >= 0 })),
        usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: ask.mock,
      });
      res.json({ ask, reactions: added, mock: ask.mock });
    } catch (e) {
      const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
      Object.assign(ask, { status: 'failed', error, answeredAt: new Date().toISOString() });
      await save(req, key, roundData);
      log.write('server.error', { route: '/api/customer/ask', ask: ask.n, error, detail: e.message });
      if (!res.headersSent) res.status(502).json({ error });
    }
  });

  r.put('/persona', requireSession(store), async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { round, key, roundData, cust } = p;
    const personas = personasOf(round, roundData);
    const next = personas.find((x) => x.id === req.body?.personaId);
    if (!next) return res.status(400).json({ error: 'bad_persona' });
    const from = cust.personaId ?? personas[0].id;
    cust.personaId = next.id;
    await save(req, key, roundData);
    logger.forSession(req.study, round).write('server.customer.personaChanged', { from, to: next.id });
    res.json({ personaId: next.id });
  });

  r.post('/reactions/:id/respond', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: true });
    if (!p) return;
    const { round, key, roundData, cust, text } = p;
    const reaction = cust.reactions.find((x) => x.id === req.params.id);
    if (!reaction) return res.status(404).json({ error: 'no_reaction' });
    if (reaction.responses.length >= MAX_RESPONSES) return res.status(409).json({ error: 'too_many' });
    reaction.responses.push({ text, at: new Date().toISOString() });
    // Responding to a reaction means it should be acted on.
    reaction.active = true;
    await save(req, key, roundData);
    logger.forSession(req.study, round).write('server.customer.responded', { id: reaction.id, text, responses: reaction.responses.length });
    res.json({ reaction });
  });

  r.post('/notes', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: true });
    if (!p) return;
    const { round, key, roundData, cust, text } = p;
    if (cust.notes.length >= MAX_NOTES) return res.status(409).json({ error: 'too_many' });
    const now = new Date().toISOString();
    const note = { id: nextId(cust.notes, 'g'), text, active: true, createdAt: now, createdAfterTurn: latestTurn(roundData)?.n ?? 0, sentIn: [] };
    cust.notes.push(note);
    await save(req, key, roundData);
    logger.forSession(req.study, round).write('server.customer.note', { id: note.id, text });
    res.json({ note });
  });

  const setActive = (kind) => async (req, res) => {
    const p = parse(req, res);
    if (!p) return;
    const { key, roundData, cust } = p;
    const item = cust[kind].find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'bad_active' });
    item.active = req.body.active;
    await save(req, key, roundData);
    res.json({ item });
  };
  r.put('/reactions/:id', requireSession(store), setActive('reactions'));
  r.put('/notes/:id', requireSession(store), setActive('notes'));

  return r;
}

// The text /api/chat sends for a customer turn, and what the turn records. reactions and notes are the
// stored objects that are on.
export function customerRevision(config, { reactions, notes, draft }) {
  const lines = [];
  if (reactions.length) {
    lines.push('Reactions of the reader:');
    reactions.forEach((x, i) => {
      const where = x.start >= 0 || x.quote ? ` to "${x.quote}"` : '';
      lines.push(`${i + 1}. ${x.personaName} (${x.tone})${where}: "${x.text}"`);
      for (const resp of x.responses ?? []) lines.push(`   Author's response: ${resp.text}`);
    });
  }
  if (notes.length) {
    if (lines.length) lines.push('');
    lines.push('General instructions from the author:');
    for (const x of notes) lines.push(`- ${x.text}`);
  }
  const text = lines.join('\n');
  return {
    text,
    input: draft ? `${config.ai.customer.reviseInstruction}\n\n${text}\n\nCurrent draft:\n${draft}` : notes.map((x) => x.text).join('\n'),
    record: {
      reactions: reactions.map(({ id, personaId, tone, quote, text: rt, responses }) => ({ id, personaId, tone, quote, text: rt, responses: (responses ?? []).map((x) => x.text) })),
      notes: notes.map(({ id, text: nt }) => ({ id, text: nt })),
    },
  };
}
