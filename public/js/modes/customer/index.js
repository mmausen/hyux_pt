// Customer mode ("Customer in the Room"): the AI plays the reader of the draft (a customer persona of the
// task) and reacts to passages of it; it never suggests wording. The participant responds to the reactions
// by voice, adds general instructions and sends the changes, which gives the next version. See canvas.js.
// A mode module provides: name, createCanvas(ctx, options) and tutorialSteps (see tutorial.js).
export const name = 'customer';
export { createCanvas } from './canvas.js';
export { default as tutorialSteps } from './tutorial.js';
