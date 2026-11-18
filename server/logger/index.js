// Logger interface. Routes call logger.write(event) or logger.forSession(session, round).write(type, payload);
// the storage behind it can change later (database, remote service) without touching the routes.
// Today: one JSONL file per participant (jsonlLogger.js).
//
// Every event has the same fields, in this order (null when not known):
// { ts, clientTs, participantId, sessionId, round, taskId, msSinceTaskStart, type, payload }
//   ts               server time (ISO) when the event was written
//   clientTs         browser time (ISO) when the event happened; null for server events
//   round            1..N for tasks, 0 for the tutorial practice turn, null outside a round
//   msSinceTaskStart ms since the participant selected Start Task in this round
import { createJsonlLogger } from './jsonlLogger.js';

const orNull = (v) => (v === undefined ? null : v);

function normalize(event) {
  return {
    ts: new Date().toISOString(),
    clientTs: orNull(event.clientTs),
    participantId: orNull(event.participantId),
    sessionId: orNull(event.sessionId),
    round: orNull(event.round),
    taskId: orNull(event.taskId),
    msSinceTaskStart: orNull(event.msSinceTaskStart),
    type: event.type,
    payload: event.payload ?? {},
  };
}

// Context of a round on the server: the task ID comes from the session's plan, the task start from the
// round state the browser saved (state.rounds[round].taskStartedAt, epoch ms).
export function roundContext(session, round) {
  if (!Number.isInteger(round)) return { round: null, taskId: null, msSinceTaskStart: null };
  const taskId = round === 0 ? 'practice' : orNull(session.plan?.[round - 1]);
  const startedAt = session.state?.rounds?.[round]?.taskStartedAt;
  return { round, taskId, msSinceTaskStart: Number.isFinite(startedAt) ? Date.now() - startedAt : null };
}

export function createLogger({ config, root }) {
  const impl = createJsonlLogger({ dir: `${root}/${config.logging.dir}` });
  const write = (event) => impl.write(normalize(event));
  return {
    write,
    // Server-side events for one session (and optionally one round).
    forSession(session, round = null) {
      return {
        write: (type, payload = {}) => write({
          participantId: session.participantId,
          sessionId: session.id,
          ...roundContext(session, round),
          type,
          payload,
        }),
      };
    },
    storeAudio: config.logging.storeAudio ? impl.storeAudio : null,
  };
}
