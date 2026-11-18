// /api/log: the browser's logEvent(type, payload) ends up here. Participant and session come from
// the server-side session, never from the request body.
import { Router } from 'express';
import { requireSession } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

const TYPE = /^[a-z][A-Za-z0-9_.]{0,63}$/;

export function logRoutes(app) {
  const r = Router();
  const limit = rateLimit({ name: 'log', windowMs: 60_000, max: 600, key: (req) => req.study.id });

  r.post('/', requireSession(app.store), limit, (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    for (const e of events.slice(0, 50)) {
      if (!e || !TYPE.test(e.type ?? '')) continue;
      app.logger.write({
        participantId: req.study.participantId,
        sessionId: req.study.id,
        round: Number.isInteger(e.round) ? e.round : null,
        taskId: typeof e.taskId === 'string' ? e.taskId.slice(0, 64) : null,
        msSinceTaskStart: Number.isFinite(e.msSinceTaskStart) ? Math.round(e.msSinceTaskStart) : null,
        clientTs: typeof e.clientTs === 'string' ? e.clientTs.slice(0, 40) : null,
        type: e.type,
        payload: e.payload && typeof e.payload === 'object' ? e.payload : {},
      });
    }
    res.json({ ok: true });
  });
  return r;
}
