// logEvent(type, payload) → POST /api/log → server logger.
// Every event carries round, task ID, client timestamp and ms since task start; the server adds
// participant ID, session ID and its own timestamp. Events before a session exists are buffered.
import { api, getSessionId } from './api.js';

const queue = [];
const MAX_QUEUE = 2000;
const listeners = new Set();
let contextProvider = () => ({});
let timer = null;

export function setLogContext(fn) {
  contextProvider = fn;
}

export function onLogEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function logEvent(type, payload = {}) {
  const ctx = contextProvider() ?? {};
  const event = {
    type,
    payload,
    round: ctx.round ?? null,
    taskId: ctx.taskId ?? null,
    msSinceTaskStart: ctx.taskStartedAt ? Date.now() - ctx.taskStartedAt : null,
    clientTs: new Date().toISOString(),
  };
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE); // offline for long: keep the newest
  listeners.forEach((fn) => fn(event));
  scheduleFlush();
  return event;
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushLog(); }, 1000);
}

export async function flushLog({ keepalive = false } = {}) {
  if (!getSessionId() || queue.length === 0) return;
  const batch = queue.splice(0, 50);
  try {
    await api.log(batch, { keepalive });
  } catch (e) {
    if (e.status !== 401) queue.unshift(...batch); // keep for the next attempt
  }
  if (queue.length) scheduleFlush();
}

// Send what is left when the tab is hidden or closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushLog({ keepalive: true });
});
