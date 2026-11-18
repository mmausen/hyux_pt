// Live input level (0..1) from a MediaStream via the Web Audio API.
let sharedCtx = null;

function audioContext() {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

export function createLevelMeter(stream, onLevel) {
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let raf = 0;
  let peak = 0;
  let smoothed = 0;

  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    // Map RMS to a perceptual 0..1 scale (speech is roughly 0.02–0.3 RMS).
    const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 60) / 50));
    smoothed = Math.max(level, smoothed * 0.85);
    peak = Math.max(peak, level);
    onLevel?.(smoothed);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    get peak() { return peak; },
    resetPeak() { peak = 0; },
    stop() {
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch { /* already disconnected */ }
      onLevel?.(0);
    },
  };
}

// Peak level above which we consider that speech was picked up.
export const SPEECH_LEVEL = 0.35;
