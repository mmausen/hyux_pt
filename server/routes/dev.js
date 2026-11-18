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
      mode: config.interaction.mode,
      dev: { mock: { stt: config.dev.mockByDefault, llm: config.dev.mockByDefault } },
    });
    logger.write({ participantId: session.participantId, sessionId: session.id, type: 'session.started', payload: { dev: true, plan: session.plan, mode: session.mode } });
    res.status(201).json(sessionView(session, app));
  });

  r.put('/mock', requireSession(store), async (req, res) => {
    const { stt, llm } = req.body ?? {};
    await store.update(req.study, (s) => {
      s.dev = { ...(s.dev ?? {}), mock: { stt: Boolean(stt), llm: Boolean(llm) } };
    });
    res.json({ mock: req.study.dev.mock });
  });

  // Interaction mode of the current session (default: interaction.mode in config.js).
  r.put('/mode', requireSession(store), async (req, res) => {
    const mode = req.body?.mode;
    if (!app.modes.includes(mode)) return res.status(400).json({ error: 'bad_mode' });
    const from = req.study.mode ?? config.interaction.mode;
    await store.update(req.study, (s) => { s.mode = mode; });
    logger.forSession(req.study).write('session.modeChanged', { from, to: mode, via: 'dev' });
    res.json({ mode });
  });

  return r;
}
