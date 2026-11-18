// Intents interaction mode: the first spoken instruction produces a first draft; after that, what the
// participant says becomes intent cards (switch on/off, change by voice), and a send hands the AI only the
// active intents plus the latest draft. See canvas.js.
// A mode module provides: name, createCanvas(ctx, options) and tutorialSteps (see tutorial.js).
export const name = 'intents';
export { createCanvas } from './canvas.js';
export { default as tutorialSteps } from './tutorial.js';
