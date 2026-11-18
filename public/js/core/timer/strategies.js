// Timer strategies. Each returns the ordered milestones of a task timer, in task milliseconds:
//   { at, event, phase, ends }  — event is logged, phase drives the UI, ends = the task must end now.
// Phases: 'running' → 'warning' → (hard) end | (soft) 'overtime' | (grace) 'grace' → end.

const warning = (limitMs, cfg) => {
  const at = limitMs - cfg.warningSecondsBeforeLimit * 1000;
  return at > 0 && cfg.warningSecondsBeforeLimit > 0 ? [{ at, event: 'warning', phase: 'warning' }] : [];
};

export const strategies = {
  // A: input stops at the limit and the study moves on automatically.
  hard: (limitMs, cfg) => [
    ...warning(limitMs, cfg),
    { at: limitMs, event: 'limit', phase: 'ended', ends: true },
  ],
  // B: a visual cue at the limit; the participant finishes when ready.
  soft: (limitMs, cfg) => [
    ...warning(limitMs, cfg),
    { at: limitMs, event: 'limit', phase: 'overtime' },
  ],
  // C: n more minutes after the limit, then like hard.
  grace: (limitMs, cfg) => [
    ...warning(limitMs, cfg),
    { at: limitMs, event: 'limit', phase: 'grace' },
    { at: limitMs + cfg.graceMinutes * 60_000, event: 'graceEnd', phase: 'ended', ends: true },
  ],
};
