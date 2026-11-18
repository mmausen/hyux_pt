// /api/transcribe and /api/health. /api/chat is in chat.js.
import { Router } from 'express';
import multer from 'multer';
import { requireSession, useMock } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';

// MediaRecorder formats differ by browser: Chrome/Edge/Firefox record webm or ogg (Opus), Safari records mp4 (AAC).
const AUDIO_TYPES = {
  'audio/webm': 'webm', 'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
const baseType = (mime) => String(mime ?? '').split(';')[0].trim().toLowerCase();

export function aiRoutes(app) {
  const { config, env, store, logger, ai, mock } = app;
  const r = Router();
  const windowMs = config.limits.rateLimit.windowSeconds * 1000;
  const sttLimit = rateLimit({ name: 'transcribe', windowMs, max: config.limits.rateLimit.transcribePerWindow, key: (req) => req.study.id });
  const llmLimit = rateLimit({ name: 'chat', windowMs, max: config.limits.rateLimit.chatPerWindow, key: (req) => req.study.id });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxAudioUploadMB * 1024 * 1024, files: 1, fields: 10 },
  }).single('audio');

  // Round of a transcription request (form field), so server events can name the task.
  const roundOf = (req) => {
    const n = Number(req.body?.round);
    return Number.isInteger(n) && n >= 0 && n <= req.study.plan.length ? n : null;
  };
  const fail = (req, res, status, error, detail) => {
    logger.forSession(req.study, roundOf(req)).write('server.error', { route: req.originalUrl, error, detail });
    res.status(status).json({ error });
  };

  r.post('/transcribe', requireSession(store), sttLimit, (req, res) => {
    upload(req, res, async (uploadErr) => {
      if (uploadErr) return fail(req, res, uploadErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400, uploadErr.code === 'LIMIT_FILE_SIZE' ? 'audio_too_large' : 'bad_upload', uploadErr.message);
      const f = req.file;
      if (!f || !f.size) return fail(req, res, 400, 'no_audio');
      const ext = AUDIO_TYPES[baseType(f.mimetype)];
      if (!ext) return fail(req, res, 415, 'unsupported_audio', f.mimetype);
      const purpose = req.body?.purpose === 'systemCheck' ? 'systemCheck' : 'task';
      const service = useMock(req, env, 'stt') ? mock : ai;
      const log = logger.forSession(req.study, roundOf(req));
      const started = Date.now();
      try {
        const audioFile = logger.storeAudio
          ? await logger.storeAudio({ participantId: req.study.participantId, sessionId: req.study.id, buffer: f.buffer, ext })
          : null;
        const out = await service.transcribe({
          buffer: f.buffer, mimetype: baseType(f.mimetype), filename: `recording.${ext}`, purpose,
          signal: AbortSignal.timeout(config.stt.timeoutSeconds * 1000),
        });
        log.write('server.transcribe', {
          purpose, latencyMs: Date.now() - started, bytes: f.size, mimeType: baseType(f.mimetype),
          chars: out.text.length, text: out.text, audioFile, mock: service === mock,
        });
        res.json({ text: out.text, mock: service === mock || undefined });
      } catch (e) {
        fail(req, res, 502, e.name === 'TimeoutError' ? 'stt_timeout' : 'stt_failed', e.message);
      }
    });
  });

  r.get('/health', requireSession(store), llmLimit, async (req, res) => {
    const service = useMock(req, env, 'llm') ? mock : ai;
    try {
      const out = await service.health({ signal: AbortSignal.timeout(config.systemCheck.llmTimeoutSeconds * 1000) });
      res.json({ ok: out.ok, mock: service === mock || undefined });
    } catch (e) {
      fail(req, res, 502, e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_failed', e.message);
    }
  });

  return r;
}
