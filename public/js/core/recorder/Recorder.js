// Recorder interface. Wraps MediaRecorder; subclasses decide how the participant starts and stops a
// recording (pushToTalk.js: hold, toggle.js: click). Usage:
//
//   const rec = createRecorder(config.interaction.recordingMode, {
//     maxSeconds, keyboard, onStart(), onStop({ blob, durationMs, mimeType, ext, reason, peak }), onLevel(level), onError(err)
//   });
//   keyboard (push-to-talk): 'global' = Space anywhere on the page (the main record button);
//   'focus' = Space or Enter only while the button has focus (e.g. one of several record buttons).
//   rec.attach(buttonEl);   // binds input handling
//   rec.setEnabled(false);  // e.g. while the AI is working or after the time limit
//   rec.stop('timeLimit');  // force stop; onStop still fires so the audio is not lost
//   rec.destroy();
import { getMicStream } from './micStream.js';
import { createLevelMeter } from './levelMeter.js';
import { pickFormat, extensionFor } from './mediaFormat.js';

export const MIN_RECORDING_MS = 400;

export class Recorder {
  constructor({ maxSeconds = 60, keyboard = 'global', onStart, onStop, onLevel, onError, onTick } = {}) {
    Object.assign(this, { maxSeconds, keyboard, onStart, onStop, onLevel, onError, onTick });
    this.recording = false;
    this.enabled = true;
    this.button = null;
    this._starting = null;
    this._stopRequested = null;
  }

  get mode() { return 'base'; }

  attach(button) {
    this.button = button;
    button.setAttribute('aria-pressed', 'false');
  }

  detach() {
    this.button = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.button) this.button.disabled = !enabled;
    if (!enabled && this.recording) this.stop('disabled');
  }

  async start() {
    if (!this.enabled || this.recording || this._starting) return;
    this._stopRequested = null;
    this._starting = (async () => {
      const stream = await getMicStream();
      const format = pickFormat();
      const mr = new MediaRecorder(stream, format ? { mimeType: format.mimeType } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      this._meter = createLevelMeter(stream, this.onLevel);
      this._mr = mr;
      this._chunks = chunks;
      this._startedAt = performance.now();
      mr.start(250);
      this.recording = true;
      this._setPressed(true);
      this._limitTimer = setTimeout(() => this.stop('maxLength'), this.maxSeconds * 1000);
      this._tickTimer = setInterval(() => this.onTick?.((performance.now() - this._startedAt) / 1000), 200);
      this.onStart?.();
    })();
    try {
      await this._starting;
    } catch (e) {
      this.recording = false;
      this._setPressed(false);
      this.onError?.(e);
      return;
    } finally {
      this._starting = null;
    }
    // A release that happened while the mic was starting (push-to-talk) stops right away.
    if (this._stopRequested) this.stop(this._stopRequested);
  }

  stop(reason = 'user') {
    if (this._starting) { this._stopRequested = reason; return; }
    if (!this.recording) return;
    this.recording = false;
    clearTimeout(this._limitTimer);
    clearInterval(this._tickTimer);
    this._setPressed(false);
    const mr = this._mr;
    const chunks = this._chunks;
    const meter = this._meter;
    const durationMs = Math.round(performance.now() - this._startedAt);
    mr.onstop = () => {
      const peak = meter.peak;
      meter.stop();
      const type = mr.mimeType || chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type });
      this.onStop?.({ blob, durationMs, mimeType: type, ext: extensionFor(type), reason, peak, tooShort: durationMs < MIN_RECORDING_MS });
    };
    try { mr.stop(); } catch (e) { meter.stop(); this.onError?.(e); }
  }

  destroy() {
    if (this.recording || this._starting) this.stop('destroy');
    this.detach();
  }

  _setPressed(on) {
    if (!this.button) return;
    this.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.button.classList.toggle('is-recording', on);
  }
}
