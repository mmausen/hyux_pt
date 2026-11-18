// /api/dev: only mounted when DEV_MODE=true. Every route here 404s in a participant deployment.
import { Router } from 'express';
import { assignTasks } from '../services/taskAssignment.js';
import { requireSession } from '../middleware/session.js';
import { sessionView } from './session.js';

export function devRoutes(app) {
  const { config, store, logger } = app;
  const r = Router();

  // "Skip ID": always a fresh session for the dev participant ID.
  r.post('/session', async (req, res) => {
    const pid = config.dev.participantId;
    const session = await store.create({
      participantId: pid,
      isDev: true,
      plan: assignTasks(pid, config),
      dev: { mock: { stt: config.dev.mockByDefault, llm: config.dev.mockByDefault } },
    });
    logger.write({ participantId: session.participantId, sessionId: session.id, type: 'session.started', payload: { dev: true, plan: session.plan } });
    res.status(201).json(sessionView(session, app));
  });

  r.put('/mock', requireSession(store), async (req, res) => {
    const { stt, llm } = req.body ?? {};
    await store.update(req.study, (s) => {
      s.dev = { ...(s.dev ?? {}), mock: { stt: Boolean(stt), llm: Boolean(llm) } };
    });
    res.json({ mock: req.study.dev.mock });
  });

  return r;
}
