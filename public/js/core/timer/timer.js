// Task timer. Counts from a stored start time, so a reload continues where it was; it does not pause
// while the AI is working. The mode (hard | soft | grace) is a strategy from strategies.js.
//
//   const timer = createTimer({ startedAt, limitMs, cfg: config.timer, speed, fired, onTick, onEvent });
//   timer.start(); timer.setSpeed(10); timer.stop();
// onTick({ elapsedMs, remainingMs, limitMs, phase, phaseEndMs, phaseRemainingMs })
// onEvent(milestone, { late }) fires once per milestone; `fired` lists events already handled before a reload.
import { strategies } from './strategies.js';

export function createTimer({ startedAt, limitMs, cfg, speed = 1, fired = [], onTick, onEvent }) {
  const milestones = strategies[cfg.mode](limitMs, cfg);
  const done = new Set(fired);
  let interval = null;
  // Elapsed task time = anchorElapsed + (now - anchorTime) × speed. Speed is a dev-mode multiplier.
  let anchorTime = Date.now();
  let anchorElapsed = Math.max(0, (anchorTime - startedAt) * speed);
  let currentSpeed = speed;

  const elapsed = () => anchorElapsed + (Date.now() - anchorTime) * currentSpeed;

  function phaseAt(ms) {
    let phase = 'running';
    for (const m of milestones) if (ms >= m.at) phase = m.phase;
    return phase;
  }

  function tick() {
    const ms = elapsed();
    const phase = phaseAt(ms);
    const next = milestones.find((m) => m.at > ms && m.phase !== 'warning');
    const phaseEndMs = phase === 'grace' ? next?.at ?? limitMs : limitMs;
    onTick?.({
      elapsedMs: ms,
      remainingMs: Math.max(0, limitMs - ms),
      limitMs,
      phase,
      phaseEndMs,
      phaseRemainingMs: Math.max(0, phaseEndMs - ms),
      graceMs: cfg.mode === 'grace' ? cfg.graceMinutes * 60_000 : 0,
    });
    for (const m of milestones) {
      if (ms >= m.at && !done.has(m.event)) {
        done.add(m.event);
        // late: the milestone passed while the page was closed; the UI can skip transitions.
        onEvent?.(m, { late: ms - m.at > 2000 * currentSpeed });
      }
    }
    if (milestones.some((m) => m.ends && done.has(m.event))) timer.stop();
  }

  const timer = {
    start() {
      if (interval) return;
      tick();
      interval = setInterval(tick, 250);
    },
    stop() {
      clearInterval(interval);
      interval = null;
    },
    setSpeed(s) {
      anchorElapsed = elapsed();
      anchorTime = Date.now();
      currentSpeed = s;
    },
    get elapsedMs() { return elapsed(); },
    get phase() { return phaseAt(elapsed()); },
  };
  return timer;
}
