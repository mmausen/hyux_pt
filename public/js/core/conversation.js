// Conversation with the assistant for one round, independent of how instructions are given. Every
// interaction mode uses this for sending instructions, streaming responses, picking up a response that
// was still being written before a reload, and telling the task screen when nothing is running.
//
//   const conv = createConversation(ctx, { round, live, sample, onUpdate, onDelta, onTurn });
//   live=false: display only (briefing backdrop, tutorial); sample: example turns for the tutorial
//   conv.turns            finished turns [{ n, transcript, response, sentAt, respondedAt, ... }]
//   conv.inflight         the turn being answered right now, or null
//   conv.error            'chat' | 'timeout' | 'rateLimited' | 'pendingLost' | null
//   await conv.send(text, logPayload, body)   → the stored turn, or null if it failed
//                         body: extra request fields for /api/chat (intents mode: { intentIds })
//   conv.setBusy(key, on) mode-specific work that must finish before the task ends (e.g. 'transcribe')
//   conv.isBusy(), conv.whenIdle(), conv.clearError(), conv.destroy()
//
// onUpdate()          state changed: re-render
// onDelta(response)   streaming text so far, for a cheap partial update
// onTurn(turn, { resumed })  a response finished (resumed: it was pending before a reload)
//
// The server stores every turn (session.rounds[round].turns); a turn's instruction field is called
// `transcript` for historical reasons, whatever the mode.
import { api } from './api.js';
import { sendChat } from './aiClient.js';
import { logEvent } from './logEvent.js';

// Reloading or closing the page cuts the response stream. That is not a failed request (the server
// finishes and stores the turn, and the next page load picks it up), so it is not reported as one.
let unloading = false;
addEventListener('beforeunload', () => { unloading = true; });
addEventListener('pagehide', () => { unloading = true; });

export function createConversation(ctx, { round, live = true, sample = null, onUpdate = () => {}, onDelta = () => {}, onTurn = null }) {
  const { config, session } = ctx;
  const serverTurns = () => session.data?.rounds?.[String(round)]?.turns ?? [];

  const turns = sample ? [...sample] : serverTurns().filter((x) => x.status === 'done');
  let inflight = null;
  let error = null;
  let destroyed = false;
  let pollTimer = null;
  const work = new Set();
  const waiters = [];

  const isBusy = () => Boolean(inflight) || work.size > 0;
  const settle = () => { if (!isBusy()) waiters.splice(0).forEach((fn) => fn()); };

  // Keep the client copy of the session in step, so later screens (review) see the turn without a reload.
  function remember(turn) {
    if (!session.data) return;
    const rounds = session.data.rounds ?? (session.data.rounds = {});
    const r = rounds[String(round)] ?? (rounds[String(round)] = { turns: [] });
    r.turns = [...r.turns.filter((x) => x.n !== turn.n), turn];
  }

  async function send(text, logPayload = {}, body = {}) {
    if (!text || inflight || destroyed) return null;
    error = null;
    inflight = { n: turns.length + 1, transcript: text, response: '', status: 'pending', sentAt: new Date().toISOString() };
    const n = inflight.n;
    onUpdate();
    // The instruction text itself is logged by the server (server.ai.request).
    logEvent('ai.sent', { turn: n, chars: text.length, ...logPayload });
    const started = performance.now();
    let firstTokenMs = null;
    try {
      const turn = await sendChat({
        round,
        text,
        body,
        onDelta(d) {
          if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
          inflight.response += d;
          onDelta(inflight.response);
        },
      });
      if (destroyed) return null;
      turns.push(turn);
      remember(turn);
      logEvent('ai.received', { turn: turn.n, latencyMs: Math.round(performance.now() - started), firstTokenMs, chars: turn.response.length, mock: turn.mock });
      onTurn?.(turn, { resumed: false });
      return turn;
    } catch (e) {
      if (destroyed || unloading) return null;
      error = e.code === 'llm_timeout' ? 'timeout' : e.code === 'rate_limited' ? 'rateLimited' : 'chat';
      logEvent('ai.failed', { turn: n, error: e.code ?? e.name });
      return null;
    } finally {
      inflight = null;
      if (!destroyed) onUpdate();
      settle();
    }
  }

  // A turn still pending on the server (page reloaded while the AI was answering): wait for it.
  function resumePending() {
    const pending = serverTurns().find((x) => x.status === 'pending');
    if (!pending) return;
    inflight = { ...pending };
    const deadline = Date.now() + (config.ai.timeoutSeconds + 15) * 1000;
    const poll = async () => {
      if (destroyed) return;
      try {
        const data = await api.getSession();
        session.set(data);
        const turn = (data.rounds?.[String(round)]?.turns ?? []).find((x) => x.n === pending.n);
        if (turn?.status === 'done') {
          turns.push(turn);
          inflight = null;
          logEvent('ai.received', { turn: turn.n, resumed: true, latencyMs: turn.latencyMs ?? null, firstTokenMs: turn.firstTokenMs ?? null, chars: turn.response.length, mock: turn.mock });
          onTurn?.(turn, { resumed: true });
        } else if (!turn || Date.now() > deadline) {
          inflight = null;
          error = 'pendingLost';
        }
      } catch { /* try again */ }
      if (inflight) pollTimer = setTimeout(poll, 2000);
      else { onUpdate(); settle(); }
    };
    pollTimer = setTimeout(poll, 1000);
  }

  if (live && !sample) resumePending();

  return {
    get turns() { return turns; },
    get inflight() { return inflight; },
    get error() { return error; },
    clearError() { error = null; },
    send,
    setBusy(key, on) {
      if (on) work.add(key);
      else work.delete(key);
      settle();
    },
    isBusy,
    whenIdle() {
      return isBusy() ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve();
    },
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      // An in-flight request is not aborted: the server stores the turn either way.
      waiters.splice(0).forEach((fn) => fn());
    },
  };
}
