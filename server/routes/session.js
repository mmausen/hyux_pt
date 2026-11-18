// /api/session: participant ID check (server-side only), session start/resume and browser state.
import { Router } from 'express';
import { normalizeId } from '../services/sessions.js';
import { assignTasks } from '../services/taskAssignment.js';
import { requireSession } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function sessionView(session, app) {
  return {
    id: session.id,
    participantId: session.participantId,
    isDev: session.isDev,
    mode: session.mode ?? app.config.interaction.mode,
    completed: Boolean(session.completedAt),
    tasks: session.plan.map((id) => app.tasksById.get(id)).filter(Boolean),
    state: session.state,
    rounds: session.rounds,
    dev: app.env.devMode ? session.dev : undefined,
  };
}

export function sessionRoutes(app) {
  const { config, store, logger } = app;
  const r = Router();
  const validIds = new Set(config.participants.validIds.map(normalizeId));

  const startLimit = rateLimit({
    name: 'sessionStart',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.sessionStartPerWindow,
    key: (req) => req.ip,
  });

  r.post('/', startLimit, async (req, res) => {
    const pid = normalizeId(req.body?.participantId);
    if (!pid || pid.length > 64 || !validIds.has(pid)) {
      logger.write({ participantId: 'invalid-attempts', type: 'session.invalidId', payload: { length: pid.length } });
      return res.status(400).json({ error: 'invalid_id' });
    }
    const existing = app.store.findByParticipant(pid);
    if (!config.participants.allowReuse && existing.length) {
      const open = existing.find((s) => !s.completedAt);
      if (!open) return res.status(409).json({ error: 'id_used' });
      logger.write({ participantId: pid, sessionId: open.id, type: 'session.resumed', payload: { via: 'id' } });
      return res.json(sessionView(open, app));
    }
    const session = await store.create({
      participantId: pid,
      plan: assignTasks(pid, config),
      mode: config.interaction.mode,
      dev: app.env.devMode ? { mock: { stt: false, llm: false } } : null,
    });
    logger.write({ participantId: pid, sessionId: session.id, type: 'session.started', payload: { plan: session.plan, mode: session.mode, userAgent: req.get('user-agent') } });
    res.status(201).json(sessionView(session, app));
  });

  r.get('/', requireSession(store), (req, res) => res.json(sessionView(req.study, app)));

  // The browser saves its whole state blob (current step, timer, draft). Server-owned fields are untouched.
  r.put('/state', requireSession(store), async (req, res) => {
    const state = req.body?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ error: 'bad_state' });
    await store.update(req.study, (s) => { s.state = state; });
    res.json({ ok: true });
  });

  r.post('/complete', requireSession(store), async (req, res) => {
    if (!req.study.completedAt) {
      await store.update(req.study, (s) => { s.completedAt = new Date().toISOString(); });
      logger.write({ participantId: req.study.participantId, sessionId: req.study.id, type: 'session.completed', payload: {} });
    }
    res.json({ ok: true, completionCode: config.study.completionCode || null });
  });

  return r;
}
