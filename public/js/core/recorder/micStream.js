// Shared microphone stream. Permission is asked once and the stream is reused by the system check,
// the tutorial and the task canvas, so participants are not prompted again on every screen.
let streamPromise = null;

export class MicError extends Error {
  // kind: 'denied' | 'notFound' | 'inUse' | 'insecure' | 'unsupported' | 'unknown'
  constructor(kind, cause) {
    super(kind);
    this.kind = kind;
    this.cause = cause;
  }
}

function classify(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError': return window.isSecureContext ? 'denied' : 'insecure';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError': return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError': return 'inUse';
    default: return 'unknown';
  }
}

const alive = (s) => s && s.getAudioTracks().some((t) => t.readyState === 'live');

export async function getMicStream() {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError(window.isSecureContext ? 'unsupported' : 'insecure');
  if (streamPromise) {
    const s = await streamPromise.catch(() => null);
    if (alive(s)) return s;
    streamPromise = null;
  }
  streamPromise = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  }).catch((e) => {
    streamPromise = null;
    throw new MicError(classify(e), e);
  });
  return streamPromise;
}

export function releaseMic() {
  if (!streamPromise) return;
  streamPromise.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
  streamPromise = null;
}

export function micLabel(stream) {
  return stream?.getAudioTracks()[0]?.label ?? '';
}
