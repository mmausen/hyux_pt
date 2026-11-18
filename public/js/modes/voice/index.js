// Voice interaction mode: the participant instructs the AI by voice only; the AI answers in text.
// A mode module provides: createCanvas(ctx, options) and tutorialSteps (see tutorial.js).
// To add a mode, create public/js/modes/<name>/ with the same exports and set interaction.mode in config.js.
export const name = 'voice';
export { createCanvas } from './canvas.js';
export { default as tutorialSteps } from './tutorial.js';
