// AI client: sends an instruction to /api/chat and reads the NDJSON stream. Mode-independent.
import { getSessionId, ApiError } from './api.js';

// Returns the stored turn { n, transcript, response, sentAt, respondedAt, ... }.
// body: extra request fields, e.g. { intentIds } in the intents mode (see server/routes/chat.js).
// onEvent(msg): any other message of the stream (intents mode: {type:'structuring'}, {type:'intents', …}).
export async function sendChat({ round, text, body = {}, onDelta, onEvent, signal }) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() ?? '' },
      body: JSON.stringify({ ...body, round, text }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', e.message);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try { code = (await res.json()).error ?? code; } catch { /* not JSON */ }
    throw new ApiError(res.status, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      throw new ApiError(0, 'network', e.message);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'delta') onDelta?.(msg.text);
      else if (msg.type === 'done') return msg.turn;
      else if (msg.type === 'error') throw new ApiError(502, msg.error);
      else onEvent?.(msg);
    }
  }
  throw new ApiError(0, 'network', 'stream ended early');
}
