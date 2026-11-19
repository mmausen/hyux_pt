// All server calls. The browser never talks to OpenAI directly.
const SESSION_KEY = 'hyux.sessionId';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

let sessionId = null;
try { sessionId = localStorage.getItem(SESSION_KEY); } catch { /* storage blocked: no resume after reload */ }

export function setSessionId(id) {
  sessionId = id;
  try { if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
export const getSessionId = () => sessionId;

async function request(method, url, { json, body, signal, keepalive } = {}) {
  const headers = {};
  if (sessionId) headers['X-Session-Id'] = sessionId;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : body, signal, keepalive });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw new ApiError(0, 'network', e.message);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try { code = (await res.json()).error ?? code; } catch { /* not JSON */ }
    throw new ApiError(res.status, code);
  }
  return res.json();
}

export const api = {
  getConfig: () => request('GET', '/api/config'),
  startSession: (participantId) => request('POST', '/api/session', { json: { participantId } }),
  getSession: () => request('GET', '/api/session'),
  saveState: (state, opts) => request('PUT', '/api/session/state', { json: { state }, ...opts }),
  complete: () => request('POST', '/api/session/complete', { json: {} }),
  log: (events, opts) => request('POST', '/api/log', { json: { events }, ...opts }),
  health: (signal) => request('GET', '/api/health', { signal }),
  transcribe(blob, { purpose = 'task', round = null, filename = 'recording', signal } = {}) {
    const form = new FormData();
    form.append('purpose', purpose);
    if (Number.isInteger(round)) form.append('round', String(round));
    form.append('audio', blob, filename);
    return request('POST', '/api/transcribe', { body: form, signal });
  },
  // Intent cards of the intents mode (server/routes/intents.js).
  intents: {
    start: (round) => request('POST', '/api/intents/start', { json: { round } }),
    synthesize: (round, text, signal) => request('POST', '/api/intents/synthesize', { json: { round, text }, signal }),
    annotate: (round, id, text, signal) => request('POST', `/api/intents/${encodeURIComponent(id)}/annotate`, { json: { round, text }, signal }),
    setActive: (round, id, active) => request('PUT', `/api/intents/${encodeURIComponent(id)}`, { json: { round, active } }),
    remove: (round, id) => request('DELETE', `/api/intents/${encodeURIComponent(id)}`, { json: { round } }),
  },
  dev: {
    startSession: () => request('POST', '/api/dev/session', { json: {} }),
    setMock: (mock) => request('PUT', '/api/dev/mock', { json: mock }),
    setMode: (mode) => request('PUT', '/api/dev/mode', { json: { mode } }),
  },
};
