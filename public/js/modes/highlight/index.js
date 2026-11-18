// Highlight interaction mode: the participant works directly on the draft. They highlight a passage,
// annotate it by voice, and send it to the AI, which changes only what is needed. A challenge button asks
// a short question about the highlighted passage that makes them consider an alternative. See canvas.js.
// No tutorialSteps yet: the tutorial screen skips itself for this mode.
export const name = 'highlight';
export { createCanvas } from './canvas.js';
