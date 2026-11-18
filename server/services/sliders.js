// Sliders of the 'slider' interaction mode: helpers shared by /api/slider and /api/chat.
// A slider is one decision about the text, a scale between two opposite poles a and b:
//   { id, theme, a, b, source: 'task' | 'voice', createdAt, transcript?, removedAt? }
// Its value is a position 0..4: 0 = strongly a, 1 = leaning a, 2 = balanced, 3 = leaning b, 4 = strongly b.
export const POSITIONS = 5;
export const BALANCED = 2;

export const activeSliders = (roundData) => (roundData?.sliders ?? []).filter((s) => !s.removedAt);

// How a position reads in the prompt.
export function positionText(s, value) {
  if (value === BALANCED) return `balanced between “${s.a}” and “${s.b}”`;
  const strength = value === 0 || value === POSITIONS - 1 ? 'strongly' : 'leaning';
  return `${strength} towards “${value < BALANCED ? s.a : s.b}”`;
}

// One line per decision: "- Selling Pace (“Close fast” ↔ “Take it slow”): strongly towards “Close fast”".
export const describe = (settings) => settings.map((s) => `- ${s.theme} (“${s.a}” ↔ “${s.b}”): ${positionText(s, s.value)}`).join('\n');

// What changed between two sets of settings (by slider id), as lines for the prompt.
export function changes(prev, next) {
  const lines = [];
  for (const s of next) {
    const before = prev.find((x) => x.id === s.id);
    if (!before) lines.push(`- New decision: ${s.theme}, ${positionText(s, s.value)}`);
    else if (before.value !== s.value) lines.push(`- ${s.theme}: was ${positionText(s, before.value)}, now ${positionText(s, s.value)}`);
  }
  for (const s of prev) if (!next.some((x) => x.id === s.id)) lines.push(`- Dropped decision: ${s.theme} (was ${positionText(s, s.value)}); it no longer applies`);
  return lines.join('\n');
}

// The same decisions in the same positions give the same key, whatever the slider ids or their order.
export const cacheKey = (settings) => JSON.stringify(settings
  .map((s) => [s.theme.trim().toLowerCase(), s.a.trim().toLowerCase(), s.b.trim().toLowerCase(), s.value])
  .sort((x, y) => (x.join('|') < y.join('|') ? -1 : 1)));
