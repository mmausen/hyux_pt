// /api/slider: the 'slider' interaction mode. The server owns the sliders, next to the turns
// (session.rounds[round].sliders, see services/sliders.js). Writing a version from the slider settings is
// /api/chat with { sliders: [{ id, value }] }.
//
//   POST /api/slider/start  { round }        the round's starting draft (turn 1, as /api/intents/start) and
//                                            its sliders (from the task's `sliders` in data/tasks.json)
//   POST /api/slider/voice  { round, text }  spoken comment → create a slider, remove one, or nothing
//
// The voice call sees the prompt (config.ai.slider.voicePrompt), the current sliders and the comment.
import { Router } from 'express';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { activeSliders } from '../services/sliders.js';

const MAX_CHARS = 4000;
const clean = (v) => String(v ?? '').trim();
const publicSlider = ({ id, theme, a, b, source }) => ({ id, theme, a, b, source });

const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['create', 'remove', 'none'] },
    id: { type: 'string' },
    theme: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
  },
  required: ['action', 'id', 'theme', 'a', 'b'],
  additionalProperties: false,
};

export function sliderRoutes(app) {
  const { config, env, store, logger, ai, mock, tasksById } = app;
  const r = Router();
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });

  function parse(req, res, { needText }) {
    const session = req.study;
    const round = req.body?.round;
    if (!Number.isInteger(round) || round < 0 || round > session.plan.length) { res.status(400).json({ error: 'bad_round' }); return null; }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (needText && !text) { res.status(400).json({ error: 'empty' }); return null; }
    if (text.length > MAX_CHARS) { res.status(413).json({ error: 'too_long' }); return null; }
    const key = String(round);
    const taskId = round === 0 ? 'practice' : session.plan[round - 1];
    const roundData = (session.rounds[key] ??= { taskId, turns: [] });
    return { round, key, roundData, text, task: tasksById.get(roundData.taskId) };
  }

  r.post('/start', requireSession(store), async (req, res) => {
    const p = parse(req, res, { needText: false });
    if (!p) return;
    const { round, key, roundData, task } = p;
    const log = logger.forSession(req.study, round);
    let changed = false;
    if (!roundData.turns.length && clean(task?.scaffold)) {
      const now = new Date().toISOString();
      roundData.turns.push({ n: 1, kind: 'scaffold', transcript: '', response: clean(task.scaffold), status: 'done', sentAt: now, respondedAt: now });
      log.write('server.scaffold.shown', { turn: 1, chars: clean(task.scaffold).length, text: clean(task.scaffold) });
      changed = true;
    }
    if (!roundData.sliders) {
      const now = new Date().toISOString();
      roundData.sliders = (task?.sliders ?? []).map((s, i) => ({ id: `s${i + 1}`, theme: s.theme, a: s.a, b: s.b, source: 'task', createdAt: now }));
      log.write('server.sliders.initialized', { sliders: roundData.sliders.map(publicSlider) });
      changed = true;
    }
    if (changed) await store.update(req.study, (s) => { s.rounds[key] = roundData; });
    const first = roundData.turns[0];
    res.json({ turn: first?.kind === 'scaffold' ? first : null, sliders: activeSliders(roundData).map(publicSlider) });
  });

  r.post('/voice', requireSession(store), limit, async (req, res) => {
    const p = parse(req, res, { needText: true });
    if (!p) return;
    const { round, key, roundData, text } = p;
    roundData.sliders ??= [];
    const active = activeSliders(roundData);
    const service = useMock(req, env, 'llm') ? mock : ai;
    const log = logger.forSession(req.study, round);
    const started = Date.now();
    try {
      const list = active.length ? active.map((s) => `- id ${s.id}: ${s.theme} (“${s.a}” ↔ “${s.b}”)`).join('\n') : '(none)';
      const out = await service.structured({
        kind: 'sliderVoice',
        instructions: config.ai.slider.voicePrompt,
        input: [{ role: 'user', content: `Current sliders:\n${list}\n\nComment:\n${text}` }],
        schema: VOICE_SCHEMA,
        context: { sliders: active, text },
        signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      });
      const d = out.data ?? {};
      const now = new Date().toISOString();
      let result = { action: 'none' };
      if (d.action === 'remove') {
        const s = active.find((x) => x.id === clean(d.id));
        if (s) {
          s.removedAt = now;
          s.removedBy = text;
          result = { action: 'remove', slider: publicSlider(s) };
        }
      } else if (d.action === 'create' && clean(d.theme) && clean(d.a) && clean(d.b)) {
        if (active.length >= config.ai.slider.maxSliders) result = { action: 'full' };
        else {
          const next = roundData.sliders.reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0) + 1;
          const s = { id: `s${next}`, theme: clean(d.theme), a: clean(d.a), b: clean(d.b), source: 'voice', createdAt: now, transcript: text };
          roundData.sliders.push(s);
          result = { action: 'create', slider: publicSlider(s) };
        }
      }
      await store.update(req.study, (s) => { s.rounds[key] = roundData; });
      log.write('server.slider.voice', {
        latencyMs: Date.now() - started, transcript: text, model: d, result, usage: out.usage ?? null,
        attempts: out.attempts, attempt: out.attempt, mock: service === mock || undefined,
      });
      res.json({ ...result, sliders: activeSliders(roundData).map(publicSlider), mock: service === mock || undefined });
    } catch (e) {
      const error = e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed';
      log.write('server.error', { route: '/api/slider/voice', error, detail: e.message });
      res.status(502).json({ error });
    }
  });

  return r;
}
