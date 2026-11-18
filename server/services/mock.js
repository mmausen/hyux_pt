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
  'Here is a more personal version. It refers to her recent post on warehouse automation and puts the implementation concern first.\n\nHi Laura,\n\nI read your post on automating warehouse handovers and it reminded me of our demo in spring. You were worried about the implementation effort, and that is exactly where we have learned the most since.\n\nCould we find 20 minutes next week?\n\nBest regards',
  'Shortened to five sentences:\n\nHi Laura, I enjoyed your recent post on warehouse automation. Since our demo, we have cut typical implementation time to six weeks. A logistics company close to yours went live this quarter. I would like to show you how they budgeted for it. Do you have 20 minutes next Tuesday or Wednesday?',
];

export function createMockService({ config }) {
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
      if (config.ai.stream && onDelta) {
        for (const chunk of text.match(/\S+\s*/g) ?? []) {
          await sleep(25, signal);
          onDelta(chunk);
        }
      }
      return { text, usage: null };
    },
    async health({ signal }) {
      await sleep(latency(), signal);
      return { ok: true, model: 'mock' };
    },
  };
}
