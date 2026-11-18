// One record button: recording, then transcription. Used for the main record button of every mode and
// for smaller ones (the annotation button of an intent card). What happens with the text is up to the
// caller (onText). Logs recording.* and transcript.* events, with `log` (an object, or a function that
// returns one at the time of the event) merged into each payload.
//
//   const input = createVoiceInput(ctx, {
//     round, button, keyboard: 'global' | 'focus', busy: (key, on) => …, log: { target: … },
//     onStart(), onTick(seconds), onLevel(level), onStop(rec), onTranscribing(on), onText(text, rec), onFail(key, retry)
//   });
//   input.setEnabled(bool), input.recording, input.transcribing, input.stop(reason), input.destroy()
//
// busy(key, on): work the task end must wait for ('transcribe', and 'finalize' while a recording the app
// stopped is being handed over); normally conv.setBusy with a key prefix per button.
// onFail keys: 'tooShort' | 'empty' | 'mic' | 'transcribe' | 'rateLimited' (texts in canvas.errors).
import { api } from '../api.js';
import { logEvent } from '../logEvent.js';
import { createRecorder } from '../recorder/index.js';

export function createVoiceInput(ctx, {
  round, button, keyboard = 'global', busy = () => {}, log = {},
  onStart, onTick, onLevel, onStop, onTranscribing, onText, onFail,
}) {
  const { config } = ctx;
  const extra = () => (typeof log === 'function' ? log() : log);
  let transcribing = false;
  let destroyed = false;

  const setTranscribing = (on) => { transcribing = on; busy('transcribe', on); onTranscribing?.(on); };

  async function transcribe(rec) {
    setTranscribing(true);
    const started = performance.now();
    try {
      const res = await api.transcribe(rec.blob, { round, filename: `recording.${rec.ext}`, signal: AbortSignal.timeout((config.stt.timeoutSeconds + 5) * 1000) });
      if (destroyed) return;
      const text = (res.text ?? '').trim();
      const latencyMs = Math.round(performance.now() - started);
      if (!text) {
        logEvent('transcript.empty', { ...extra(), recordingMs: rec.durationMs, latencyMs, reason: rec.reason });
        onFail?.('empty');
      } else {
        // The transcript text itself is logged by the server (server.transcribe).
        logEvent('transcript.received', { ...extra(), chars: text.length, recordingMs: rec.durationMs, latencyMs, reason: rec.reason, mock: res.mock });
        await onText?.(text, rec);
      }
    } catch (e) {
      if (destroyed) return;
      logEvent('transcript.failed', { ...extra(), error: e.code ?? e.name, reason: rec.reason });
      onFail?.(e.code === 'rate_limited' ? 'rateLimited' : 'transcribe', () => transcribe(rec));
    } finally {
      setTranscribing(false);
    }
  }

  const recorder = createRecorder(config.interaction.recordingMode, {
    maxSeconds: config.interaction.maxRecordingSeconds,
    keyboard,
    onStart() {
      logEvent('recording.start', { ...extra(), mode: recorder.mode });
      onStart?.();
    },
    onTick: (s) => onTick?.(s),
    onLevel: (l) => onLevel?.(l),
    onStop(rec) {
      logEvent('recording.stop', { ...extra(), durationMs: rec.durationMs, reason: rec.reason, bytes: rec.blob.size, mimeType: rec.mimeType, peak: Math.round(rec.peak * 100) / 100 });
      onStop?.(rec);
      if (destroyed && rec.reason !== 'timeLimit') return busy('finalize', false);
      if (rec.tooShort || !rec.blob.size) {
        onFail?.('tooShort');
        return busy('finalize', false);
      }
      transcribe(rec); // marks itself busy before the app's stop is released, so the task end keeps waiting
      busy('finalize', false);
    },
    onError(err) {
      busy('finalize', false);
      logEvent('recording.error', { ...extra(), error: err.kind ?? err.name });
      onFail?.('mic');
    },
  });
  recorder.attach(button);

  return {
    get recording() { return recorder.recording || Boolean(recorder._starting); },
    get transcribing() { return transcribing; },
    get mode() { return recorder.mode; },
    setEnabled(on) { recorder.setEnabled(on); },
    stop(reason) {
      if (recorder.recording || recorder._starting) {
        busy('finalize', true);
        recorder.stop(reason);
      }
    },
    destroy() {
      destroyed = true;
      recorder.destroy();
    },
  };
}
