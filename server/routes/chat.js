// /api/chat: sends one instruction to the LLM. The model sees only the system prompt (config.ai.systemPrompt),
// earlier turns of the same round (if config.ai.sendHistory) and the new transcript. Never the task.
// Intents mode (Write Version): { round, intentIds } instead of text. First the active intents are
// structured into one plan (structureIntents in intents.js; the stream sends them as {type:'intents'}),
// then the model writes the text anew from the starting draft and that plan, by group
// (config.ai.intents.composeInstruction), with no history and no earlier version. If structuring fails,
// the text is written from the intents as they are. The turn records which intents it was built from.
// The server owns the conversation: turns are stored in session.rounds[round].turns.
// Response: NDJSON stream of {type:'delta', text} … then {type:'done', turn} or {type:'error', error}.
import { Router } from 'express';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { baseDraft, structureIntents, groupOf, groupsView, taskFor } from './intents.js';
import { cleanResponse } from '../../public/js/core/cleanResponse.js';

const MAX_CHARS = 4000;

export function chatRoutes(app) {
  const { config, env, store, logger, ai, mock } = app;
  const timeout = () => AbortSignal.timeout(config.ai.timeoutSeconds * 1000);
  const r = Router();
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });

  r.post('/', requireSession(store), limit, async (req, res) => {
    const session = req.study;
    const round = req.body?.round;
    let text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const intentIds = Array.isArray(req.body?.intentIds) ? req.body.intentIds : null;
    // Round 0 is the tutorial practice turn; rounds 1..N are tasks.
    if (!Number.isInteger(round) || round < 0 || round > session.plan.length) return res.status(400).json({ error: 'bad_round' });
    if (!intentIds && !text) return res.status(400).json({ error: 'empty' });
    if (text.length > MAX_CHARS) return res.status(413).json({ error: 'too_long' });

    const key = String(round);
    const taskId = round === 0 ? 'practice' : session.plan[round - 1];
    const roundData = session.rounds[key] ?? { taskId, turns: [] };
    if (roundData.turns.some((t) => t.status === 'pending')) return res.status(409).json({ error: 'busy' });

    let history = [];
    let input = text;
    if (intentIds) {
      if (!baseDraft(roundData) || !(roundData.intents ?? []).some((x) => x.active && intentIds.includes(x.id))) return res.status(400).json({ error: 'no_intents' });
    } else if (config.ai.sendHistory) {
      // A starting draft (intents mode) has no instruction; the voice mode leaves it out.
      history = roundData.turns.filter((t) => t.status === 'done' && t.kind !== 'scaffold').flatMap((t) => [
        { role: 'user', content: t.transcript },
        { role: 'assistant', content: t.response },
      ]);
    }
    const turn = { n: roundData.turns.length + 1, transcript: text, response: '', status: 'pending', sentAt: new Date().toISOString() };
    roundData.turns.push(turn);
    session.rounds[key] = roundData;
    await store.update(session, (s) => { s.rounds[key] = roundData; });

    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(session, round);

    res.status(200);
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let clientGone = false;
    res.on('close', () => { clientGone = !res.writableEnded; });
    const send = (obj) => { if (!clientGone) try { res.write(`${JSON.stringify(obj)}\n`); } catch { /* client left */ } };

    let intents = null;
    if (intentIds) {
      // Structure: all active intents into one plan. The cards on screen change to it before the text comes.
      send({ type: 'structuring' });
      const started = Date.now();
      try {
        const out = await structureIntents({ config, service, roundData, task: taskFor(app, round, roundData), signal: timeout() });
        await store.update(session, (s) => { s.rounds[key] = roundData; });
        log.write('server.intents.structured', {
          turn: turn.n, latencyMs: Date.now() - started, changes: out.changes, before: out.before,
          after: roundData.intents.filter((x) => x.active).map((x) => ({ id: x.id, group: groupOf(x), text: x.text, reason: x.reason ?? '', nuance: x.nuance ?? '' })),
          groups: roundData.groups, usage: out.usage, attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
        });
        send({ type: 'intents', intents: roundData.intents, ...groupsView(roundData), changes: out.changes });
      } catch (e) {
        log.write('server.error', { route: '/api/chat', step: 'structure', turn: turn.n, error: e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed', detail: e.message });
        send({ type: 'intents', intents: roundData.intents, ...groupsView(roundData), changes: null });
      }
      // Write: by group in the order of the plan, each intent with its nuance and the participant's reason.
      intents = roundData.intents.filter((x) => x.active);
      const order = roundData.groups ?? [];
      const rank = (g) => { const i = order.indexOf(g); return i < 0 ? order.length : i; };
      const groups = new Map();
      for (const x of [...intents].sort((a, b) => rank(groupOf(a)) - rank(groupOf(b)))) {
        const g = groupOf(x) || 'Other';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(`- ${x.text}${x.nuance ? ` (${x.nuance})` : ''}${x.reason ? ` (why: ${x.reason})` : ''}`);
      }
      text = [...groups].map(([g, lines]) => `${g}:\n${lines.join('\n')}`).join('\n\n');
      input = `${config.ai.intents.composeInstruction}\n\nBuilding blocks:\n${text}\n\nStarting draft:\n${baseDraft(roundData)}`;
      turn.transcript = text;
      turn.intents = intents.map((x) => ({ id: x.id, group: groupOf(x), text: x.text, reason: x.reason ?? '', nuance: x.nuance ?? '', updatedAt: x.updatedAt }));
    }
    log.write('server.ai.request', { turn: turn.n, model: service === mock ? 'mock' : config.ai.model, historyTurns: history.length / 2, chars: text.length, text, intents: turn.intents });

    const started = Date.now();
    let firstTokenMs = null;
    try {
      // The request is not aborted when the browser disconnects: the turn is still stored, so a reload shows it.
      const out = await service.respond({
        messages: [...history, { role: 'user', content: input }],
        onDelta: (d) => { if (firstTokenMs === null) firstTokenMs = Date.now() - started; send({ type: 'delta', text: d }); },
        signal: timeout(),
      });
      // Only the text itself is kept as the response: an introduction or closing comment of the model is
      // removed (the raw text is kept in rawResponse and logged).
      const response = cleanResponse(out.text) || out.text;
      if (response !== out.text) turn.rawResponse = out.text;
      Object.assign(turn, { response, status: 'done', respondedAt: new Date().toISOString(), latencyMs: Date.now() - started, firstTokenMs, usage: out.usage ?? undefined, mock: service === mock || undefined });
      for (const x of intents ?? []) x.sentIn = [...(x.sentIn ?? []), turn.n];
      await store.update(session, () => {});
      log.write('server.ai.response', {
        turn: turn.n, latencyMs: turn.latencyMs, firstTokenMs, chars: response.length, text: response,
        ...(turn.rawResponse ? { cleaned: true, rawText: out.text } : {}), usage: out.usage ?? null,
      });
      send({ type: 'done', turn });
    } catch (e) {
      const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
      // Remove the failed turn so the participant can resend the same instruction.
      roundData.turns = roundData.turns.filter((t) => t !== turn);
      await store.update(session, (s) => { s.rounds[key] = roundData; });
      log.write('server.error', { route: '/api/chat', turn: turn.n, error, detail: e.message });
      send({ type: 'error', error });
    }
    if (!clientGone) res.end();
  });

  return r;
}
