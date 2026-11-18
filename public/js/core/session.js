// Client view of the study session. `state` is the browser-owned blob saved to the server on
// every change (debounced), so a reload resumes exactly where the participant was.
import { api, setSessionId, getSessionId } from './api.js';

export function createSession() {
  let data = null; // { id, participantId, tasks, state, rounds, dev, completed }
  let saveTimer = null;
  let saving = Promise.resolve();
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(data));

  let failing = false;
  let retryTimer = null;

  // Saves the current state. While saving fails (offline), it retries every 5 s; onSaveStatus(false)
  // fires once when saving starts failing and onSaveStatus(true) once it works again.
  // A 401 means the server no longer knows the session: onSessionLost.
  function runSave() {
    clearTimeout(retryTimer);
    saving = saving.then(async () => {
      if (!data) return;
      try {
        await api.saveState(data.state);
        if (failing) { failing = false; session.onSaveStatus?.(true); }
      } catch (e) {
        if (e.status === 401) { session.onSessionLost?.(e); return; }
        console.warn('State save failed', e);
        if (!failing) { failing = true; session.onSaveStatus?.(false, e); }
        retryTimer = setTimeout(runSave, 5000);
      }
    });
    return saving;
  }

  function scheduleSave(immediate) {
    clearTimeout(saveTimer);
    if (immediate) return runSave();
    saveTimer = setTimeout(runSave, 400);
    return saving;
  }

  const session = {
    onSaveStatus: null,
    onSessionLost: null,
    get data() { return data; },
    get active() { return Boolean(data); },
    get state() { return data?.state ?? {}; },

    set(next) {
      data = { ...next, state: next.state ?? {} };
      setSessionId(data.id);
      emit();
    },

    clear() {
      data = null;
      setSessionId(null);
      emit();
    },

    async restore() {
      if (!getSessionId()) return false;
      try {
        session.set(await api.getSession());
        return true;
      } catch (e) {
        if (e.status !== 401) throw e;
        // The server no longer knows this session (deleted, or another server): start at the ID entry.
        session.clear();
        session.onSessionLost?.(e, { onRestore: true });
        return false;
      }
    },

    // Shallow-merge a patch into state. Use { immediate: true } for step changes.
    update(patch, { immediate = false } = {}) {
      if (!data) return Promise.resolve();
      data.state = { ...data.state, ...patch };
      emit();
      return scheduleSave(immediate);
    },

    // Per-task progress the browser keeps (draft, task start, timer events, questionnaire answers) lives
    // under state.progress[round]. Not to be confused with data.rounds: the conversation, owned by the server.
    progress(round) {
      return data?.state?.progress?.[round] ?? {};
    },
    updateProgress(round, patch, opts) {
      const progress = { ...(data?.state?.progress ?? {}) };
      progress[round] = { ...(progress[round] ?? {}), ...patch };
      return session.update({ progress }, opts);
    },

    task(round) {
      return data?.tasks?.[round - 1] ?? null;
    },

    flush() {
      clearTimeout(saveTimer);
      return data ? scheduleSave(true) : Promise.resolve();
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return session;
}
