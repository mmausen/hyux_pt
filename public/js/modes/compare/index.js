// Compare interaction mode: two similar versions side by side. The participant picks one and says what
// they like most about it; a hidden preference profile learns from it, the other version is replaced by
// a new one written from the profile, and so on until a version is accepted. See canvas.js.
// No tutorialSteps yet: the tutorial screen skips itself for this mode.
export const name = 'compare';
export { createCanvas } from './canvas.js';
