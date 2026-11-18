// Canned speech-to-text and LLM, same interface as openai.js. Only reachable when DEV_MODE=true.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

const TRANSCRIPTS = [
  'Write a short email to the customer that picks up where our last conversation ended.',
  'Make it more personal and mention the concern about implementation effort.',
  'Shorten it to five sentences and end with a clear question.',
  'Change the tone to be a bit more confident.',
];

const RESPONSES = [
  'Subject: Following up on our demo\n\nHi Laura,\n\nWhen we spoke three months ago, you mentioned two open points: the effort to implement and the timing of your budget. Both are easier to plan now than they were then.\n\nA company in your sector has just gone live with us in six weeks, without extra IT staff. I would be glad to share how they did it.\n\nWould a 20-minute call next week work for you?\n\nBest regards',
  'Hi Laura,\n\nI read your post on automating warehouse handovers and it reminded me of our demo in spring. You were worried about the implementation effort, and that is exactly where we have learned the most since.\n\nCould we find 20 minutes next week?\n\nBest regards',
  'Hi Laura, I enjoyed your recent post on warehouse automation. Since our demo, we have cut typical implementation time to six weeks. A logistics company close to yours went live this quarter. I would like to show you how they budgeted for it. Do you have 20 minutes next Tuesday or Wednesday?',
];

const CHALLENGES = [
  'Would the CFO read this passage as a benefit for the hospital, or as a benefit for you?',
  'What if the opposite were true: what would you write if a smaller renewal served the customer better?',
  'Which number would make this point harder to argue with, and do you actually have it?',
];

export function createMockService({ config }) {
  let c = 0;
  let t = 0;
  let r = 0;
  const latency = () => config.dev.mockLatencyMs;
  return {
    async transcribe({ purpose, signal }) {
      await sleep(latency(), signal);
      if (purpose === 'systemCheck') return { text: config.systemCheck.testSentence };
      return { text: TRANSCRIPTS[t++ % TRANSCRIPTS.length] };
    },
    async respond({ onDelta, signal }) {
      await sleep(latency(), signal);
      const text = RESPONSES[r++ % RESPONSES.length];
      if (onDelta) {
        for (const chunk of text.match(/\S+\s*/g) ?? []) {
          await sleep(25, signal);
          onDelta(chunk);
        }
      }
      return { text, usage: null };
    },
    // Intents without an LLM: one intent per sentence or "and"-clause of the comment (the part after
    // "because" or a comma is its reason); an annotation is appended to the intent. Good enough to
    // click through the intents mode.
    async structured({ kind, input, context = {}, signal }) {
      await sleep(latency(), signal);
      // Highlight mode: a placeholder in square brackets is replaced by the annotation; other text gets the
      // annotation added in brackets, so the change is easy to spot.
      if (kind === 'highlightEdit') {
        const { selected = '', annotation = '' } = context;
        const said = annotation.replace(/[.!?]+$/, '');
        const replace = /^\[.*\]$/s.test(selected.trim()) ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : `${selected} (${said})`;
        return { data: { edits: [{ find: selected, replace }] }, usage: null };
      }
      if (kind === 'challenge') {
        return { data: { question: CHALLENGES[c++ % CHALLENGES.length] }, usage: null };
      }
      const text = String(input.at(-1)?.content ?? '');
      const said = (label) => (text.split(`${label}:\n`)[1] ?? '').split('\n\n')[0].trim();
      const short = (s) => s.split(/\s+/).slice(0, 12).join(' ').replace(/[.,;:]+$/, '');
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      if (kind === 'annotateIntent') {
        const reason = said('Reason');
        return { data: { text: cap(short(`${said('Intent')}, ${said('Annotation')}`)), reason: reason === '(none given)' ? '' : reason }, usage: null };
      }
      const parts = said('Comment').split(/(?<=[.!?])\s+|,?\s+and\s+(?:also\s+)?/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
      // "X because Y" or "X, Y": Y is the reason.
      return {
        data: {
          intents: parts.slice(0, 3).map((p) => {
            const [, ask = p, why = ''] = p.match(/^(.+?)(?:,?\s+because\s+|,\s+)(.+)$/i) ?? [];
            return { text: cap(short(ask)), reason: why ? cap(short(why.replace(/[.!?]+$/, ''))) : '', quote: p };
          }),
        },
        usage: null,
      };
    },

    async health({ signal }) {
      await sleep(latency(), signal);
      return { ok: true, model: 'mock' };
    },
  };
}
