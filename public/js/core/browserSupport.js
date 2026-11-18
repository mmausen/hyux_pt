// Feature checks for the voice study. Recording needs a secure context (https or localhost).
export function checkBrowser() {
  const problems = [];
  if (!window.isSecureContext) problems.push('insecure');
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') problems.push('unsupported');
  if (!(window.AudioContext || window.webkitAudioContext)) problems.push('unsupported');
  if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') problems.push('unsupported');

  const ua = navigator.userAgent;
  const isChromium = /Chrome\/|Edg\//.test(ua);
  // iPadOS reports itself as Macintosh; touch points give it away.
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    preferred: isChromium,
    mobile: isMobile,
    userAgent: ua,
  };
}

export const MIN_WIDTH = 1024;
export const isScreenTooSmall = () => window.innerWidth < MIN_WIDTH;
