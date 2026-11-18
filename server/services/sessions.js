// Session store. One JSON file per session in sessions/ (gitignored), cached in memory.
// The server owns the participant, the task plan and the conversation turns; the browser owns
// a free-form `state` blob (current step, timer, draft) that it saves on every change, so a
// reload resumes where the participant was.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function normalizeId(id) {
  return String(id ?? '').trim().toUpperCase();
}

export function createSessionStore({ dir }) {
  mkdirSync(dir, { recursive: true });
  const byId = new Map();
  const writes = new Map(); // id -> promise chain, keeps writes to one file in order

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      byId.set(s.id, s);
    } catch (e) {
      console.warn(`Skipping unreadable session file ${f}: ${e.message}`);
    }
  }

  function persist(session) {
    session.updatedAt = new Date().toISOString();
    const file = path.join(dir, `${session.id}.json`);
    const data = JSON.stringify(session, null, 2);
    const prev = writes.get(session.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, file);
    }).catch((e) => console.error(`Could not save session ${session.id}: ${e.message}`));
    writes.set(session.id, next);
    return next;
  }

  return {
    get: (id) => (typeof id === 'string' ? byId.get(id) : undefined),

    findByParticipant(participantId) {
      const pid = normalizeId(participantId);
      return [...byId.values()].filter((s) => s.participantId === pid && !s.isDev)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async create({ participantId, isDev = false, plan, mode, dev }) {
      const now = new Date().toISOString();
      const session = {
        id: randomUUID(),
        participantId: normalizeId(participantId),
        isDev,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        plan, // task ID per round, index 0 = round 1
        mode, // interaction mode (public/js/modes/<mode>), fixed for the session; dev panel can change it
        state: {}, // owned by the browser
        rounds: {}, // round number -> { turns: [...] }, owned by the server
        dev: dev ?? null,
      };
      byId.set(session.id, session);
      await persist(session);
      return session;
    },

    async update(session, mutate) {
      mutate(session);
      await persist(session);
      return session;
    },
  };
}
