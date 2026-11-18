// Picks a MediaRecorder format the browser supports and the transcription API accepts.
// Chrome/Edge/Firefox: webm/opus (Firefox may prefer ogg). Safari: mp4/AAC.
const CANDIDATES = [
  { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
  { mimeType: 'audio/webm', ext: 'webm' },
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', ext: 'mp4' },
  { mimeType: 'audio/mp4', ext: 'mp4' },
  { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
];

let chosen;

export function pickFormat() {
  if (chosen !== undefined) return chosen;
  const supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported;
  chosen = (supported && CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType))) || null;
  return chosen; // null = let the browser choose; the extension is derived from the blob type
}

export function extensionFor(type) {
  const base = String(type ?? '').split(';')[0];
  if (base.includes('webm')) return 'webm';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return 'mp4';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  return 'webm';
}
