// /api/highlight: the 'highlight' interaction mode. The participant highlights a passage of the current
// draft, annotates it by voice, and either has the AI change it in place or asks for a challenge question.
//
//   POST /api/highlight/edit       { round, start, end, selected, text }  → { turn } (or { turn: null } if nothing changed)
//   POST /api/highlight/challenge  { round, start, end, selected, text? } → { question }
//
// start/end are character offsets into the latest draft; selected is the passage the browser saw (checked
// against the draft, so an edit never lands on a stale version). text is the annotation (transcribed).
//
// Edits: the LLM does not write the draft again. It returns a small list of { find, replace } edits; the
// server applies them to the draft and stores the result as a new turn (kind 'edit') with the selection,
// the annotation and the applied edits. The round starts from the starting draft (/api/intents/start).
// Challenges are stored in session.rounds[round].challenges and logged; they never change the draft.
// As in the other modes, the LLM never sees the task or the situation, only the draft and what was said.
import { Router } from 'express';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { latestDraft } from './intents.js';

const MAX_CHARS = 4000;
const MAX_EDITS = 12;
const OPEN = '⟦';
const CLOSE = '⟧';
const clean = (v) => String(v ?? '').trim();

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: { find: { type: 'string' }, replace: { type: 'string' } },
        required: ['find', 'replace'],
        additionalProperties: false,
      },
    },
  },
  required: ['edits'],
  additionalProperties: false,
};
const CHALLENGE_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  required: ['question'],
  additionalProperties: false,
};

// Applies the edits one after the other. An edit whose `find` occurs more than once is applied to the
// occurrence nearest to the selection; one that does not occur is skipped. Returns the new text, the
// applied and the skipped edits.
export function applyEdits(text, edits, selection) {
  let out = text;
  let sel = { ...selection };
  const applied = [];
  const skipped = [];
  for (const e of edits) {
    if (!e.find || e.find === e.replace) { skipped.push(e); continue; }
    let best = -1;
    for (let i = out.indexOf(e.find); i >= 0; i = out.indexOf(e.find, i + 1)) {
      const dist = i + e.find.length < sel.start ? sel.start - (i + e.find.length) : i > sel.end ? i - sel.end : 0;
      const bestDist = best < 0 ? Infinity : best + e.find.length < sel.start ? sel.start - (best + e.find.length) : best > sel.end ? best - sel.end : 0;
      if (dist < bestDist) best = i;
    }
    if (best < 0) { skipped.push(e); continue; }
    out = out.slice(0, best) + e.replace + out.slice(best + e.find.length);
    const shift = e.replace.length - e.find.length;
    // Keep the selection on the same passage for the next edit's "nearest" choice.
    if (best + e.find.length <= sel.start) sel = { start: sel.start + shift, end: sel.end + shift };
    else if (best < sel.end) sel = { start: Math.min(sel.start, best), end: Math.max(sel.end + shift, best + e.replace.length) };
    applied.push({ find: e.find, replace: e.replace, at: best });
  }
  return { text: out, applied, skipped };
}

export function highlightRoutes(app) {
  const { config, env, store, logger, ai, mock } = app;
  const r = Router();
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });

  // Validates round, selection and annotation; returns { round, key, roundData, draft, start, end, selected, text } or sends the error.
  function parse(req, res, { needText }) {
    const session = req.study;
    const { round, start, end } = req.body ?? {};
    if (!Number.isInteger(round) || round < 0 || round > session.plan.length) { res.status(400).json({ error: 'bad_round' }); return null; }
    const key = String(round);
    const roundData = session.rounds[key];
    const draft = latestDraft(roundData);
    if (!draft) { res.status(409).json({ error: 'no_draft' }); return null; }
    if (roundData.turns.some((t) => t.status === 'pending')) { res.status(409).json({ error: 'busy' }); return null; }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > draft.length || end <= start) { res.status(400).json({ error: 'bad_selection' }); return null; }
    const selected = draft.slice(start, end);
    if (typeof req.body.selected === 'string' && req.body.selected !== selected) { res.status(409).json({ error: 'draft_changed' }); return null; }
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (needText && !text) { res.status(400).json({ error: 'empty' }); return null; }
    if (text.length > MAX_CHARS) { res.status(413).json({ error: 'too_long' }); return null; }
    return { round, key, roundData, draft, start, end, selected, text };
  }

  const fail = (log, res, route, e) => {
    const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
    log.write('server.error', { route, error, detail: e.message });
    res.status(502).json({ error });
  };
  const marked = (draft, start, end) => `${draft.slice(0, start)}${OPEN}${draft.slice(start, end)}${CLOSE}${draft.slice(end)}`;

  r.post('/edit', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res, { needText: true });
    if (!p) return;
    const { round, key, roundData, draft, start, end, selected, text } = p;
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    const sentAt = new Date().toISOString();
    const started = Date.now();
    try {
      const out = await service.structured({
        kind: 'highlightEdit',
        instructions: config.ai.highlight.editPrompt,
        input: [{ role: 'user', content: `Draft (the highlighted passage is between ${OPEN} and ${CLOSE}):\n${marked(draft, start, end)}\n\nComment on the highlighted passage:\n${text}` }],
        schema: EDIT_SCHEMA,
        maxOutputTokens: config.ai.highlight.maxOutputTokens,
        hedgeAfterSeconds: config.ai.highlight.hedgeAfterSeconds,
        context: { draft, selected, annotation: text },
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      // The markers must never end up in the draft.
      const edits = (out.data?.edits ?? []).slice(0, MAX_EDITS)
        .map((e) => ({ find: String(e?.find ?? '').replaceAll(OPEN, '').replaceAll(CLOSE, ''), replace: String(e?.replace ?? '').replaceAll(OPEN, '').replaceAll(CLOSE, '') }));
      const result = applyEdits(draft, edits, { start, end });
      const latencyMs = Date.now() - started;
      const usage = out.usage ?? null;
      const mockUsed = service === mock || undefined;
      if (!result.applied.length || result.text === draft) {
        log.write('server.highlight.unchanged', { latencyMs, selection: { start, end, text: selected }, annotation: text, edits, usage, attempts: out.attempts, attempt: out.attempt, mock: mockUsed });
        return res.json({ turn: null, mock: mockUsed });
      }
      const turn = {
        n: roundData.turns.length + 1, kind: 'edit', transcript: text, selection: { start, end, text: selected },
        edits: result.applied, response: result.text, status: 'done', sentAt, respondedAt: new Date().toISOString(), latencyMs, usage: usage ?? undefined, mock: mockUsed,
      };
      if (result.skipped.length) turn.skippedEdits = result.skipped;
      roundData.turns.push(turn);
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.highlight.edited', {
        turn: turn.n, latencyMs, selection: turn.selection, annotation: text, edits: result.applied, skipped: result.skipped,
        chars: result.text.length, text: result.text, usage, attempts: out.attempts, attempt: out.attempt, mock: mockUsed,
      });
      res.json({ turn, mock: mockUsed });
    } catch (e) {
      fail(log, res, '/api/highlight/edit', e);
    }
  });

  r.post('/challenge', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { round, key, roundData, draft, start, end, selected, text } = p;
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    const started = Date.now();
    try {
      const out = await service.structured({
        kind: 'challenge',
        instructions: config.ai.highlight.challengePrompt,
        input: [{ role: 'user', content: `Draft (the highlighted passage is between ${OPEN} and ${CLOSE}):\n${marked(draft, start, end)}\n\nHighlighted passage:\n${selected}\n\nAuthor's comment on it:\n${text || '(none)'}` }],
        schema: CHALLENGE_SCHEMA,
        context: { draft, selected, annotation: text },
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const question = clean(out.data?.question);
      if (!question) throw new Error('The model returned no question');
      const challenge = { question, selection: { start, end, text: selected }, annotation: text, afterTurn: roundData.turns.at(-1)?.n ?? 0, at: new Date().toISOString() };
      (roundData.challenges ??= []).push(challenge);
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.highlight.challenge', {
        latencyMs: Date.now() - started, ...challenge, usage: out.usage ?? null, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
      });
      res.json({ question, mock: service === mock || undefined });
    } catch (e) {
      fail(log, res, '/api/highlight/challenge', e);
    }
  });

  return r;
}
