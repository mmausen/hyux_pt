// /api/chat: sends one instruction to the LLM. The model sees only the system prompt (config.ai.systemPrompt),
// earlier turns of the same round (if config.ai.sendHistory) and the new transcript. Never the task.
// Intents mode: { round, intentIds } instead of text. The model then gets no history, only the latest
// draft and the listed intents (config.ai.intents.reviseInstruction); the turn records which intents.
// The server owns the conversation: turns are stored in session.rounds[round].turns.
// Response: NDJSON stream of {type:'delta', text} … then {type:'done', turn} or {type:'error', error}.
import { Router } from 'express';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { latestDraft } from './intents.js';

const MAX_CHARS = 4000;

export function chatRoutes(app) {
  const { config, env, store, logger, ai, mock } = app;
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

    let history;
    let input;
    let intents = null;
    if (intentIds) {
      // Intents: the latest draft and the chosen intents, nothing else.
      const draft = latestDraft(roundData);
      intents = (roundData.intents ?? []).filter((x) => intentIds.includes(x.id));
      if (!draft || !intents.length) return res.status(400).json({ error: 'no_intents' });
      text = intents.map((x) => `- ${x.text}`).join('\n');
      history = [];
      input = `${config.ai.intents.reviseInstruction}\n\nIntents:\n${text}\n\nCurrent draft:\n${draft}`;
    } else {
      history = config.ai.sendHistory
        ? roundData.turns.filter((t) => t.status === 'done').flatMap((t) => [
          { role: 'user', content: t.transcript },
          { role: 'assistant', content: t.response },
        ])
        : [];
      input = text;
    }
    const turn = { n: roundData.turns.length + 1, transcript: text, response: '', status: 'pending', sentAt: new Date().toISOString() };
    if (intents) turn.intents = intents.map(({ id, text: t }) => ({ id, text: t }));
    roundData.turns.push(turn);
    await store.update(session, (s) => { s.rounds[key] = roundData; });

    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(session, round);
    log.write('server.ai.request', { turn: turn.n, model: service === mock ? 'mock' : config.ai.model, historyTurns: history.length / 2, chars: text.length, text, intents: turn.intents });

    res.status(200);
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let clientGone = false;
    res.on('close', () => { clientGone = !res.writableEnded; });
    const send = (obj) => { if (!clientGone) try { res.write(`${JSON.stringify(obj)}\n`); } catch { /* client left */ } };

    const started = Date.now();
    let firstTokenMs = null;
    try {
      // The request is not aborted when the browser disconnects: the turn is still stored, so a reload shows it.
      const out = await service.respond({
        messages: [...history, { role: 'user', content: input }],
        onDelta: (d) => { if (firstTokenMs === null) firstTokenMs = Date.now() - started; send({ type: 'delta', text: d }); },
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      Object.assign(turn, { response: out.text, status: 'done', respondedAt: new Date().toISOString(), latencyMs: Date.now() - started, firstTokenMs, usage: out.usage ?? undefined, mock: service === mock || undefined });
      for (const x of intents ?? []) x.sentIn = [...(x.sentIn ?? []), turn.n];
      await store.update(session, () => {});
      log.write('server.ai.response', { turn: turn.n, latencyMs: turn.latencyMs, firstTokenMs, chars: out.text.length, text: out.text, usage: out.usage ?? null });
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
