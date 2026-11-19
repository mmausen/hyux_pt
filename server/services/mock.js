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
      if (onDelta) {
        for (const chunk of text.match(/\S+\s*/g) ?? []) {
          await sleep(25, signal);
          onDelta(chunk);
        }
      }
      return { text, usage: null };
    },
    // Intents without an LLM. Synthesis: one request per sentence or "and"-clause of the comment (the
    // part after "because" or a comma is its reason), sorted into a topic by keywords; a request that
    // shares a longer word with an intent of the same topic, or finds its topic full, is merged into that
    // intent; the other current intents stay as they are. An annotation is appended to the intent. Good
    // enough to click through the intents mode.
    async structured({ kind, input, signal }) {
      await sleep(latency(), signal);
      const text = String(input.at(-1)?.content ?? '');
      const said = (label) => (text.split(`${label}:\n`)[1] ?? '').split('\n\n')[0].trim();
      const short = (s, n = 12) => s.split(/\s+/).slice(0, n).join(' ').replace(/[.,;:]+$/, '');
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      if (kind === 'annotateIntent') {
        const reason = said('Reason');
        return { data: { text: cap(short(`${said('Intent')}, ${said('Annotation')}`)), reason: reason === '(none given)' ? '' : reason }, usage: null };
      }
      let current = [];
      try { current = JSON.parse(said('Current intents') || '[]'); } catch { current = []; }
      const topicFor = (p) => (/tone|formal|friendl|personal|confiden|warm|polite/i.test(p) ? 'tone'
        : /shorten|shorter|longer|order|end with|start with|opening|closing|paragraph|sentences|structure/i.test(p) ? 'structure'
          : /mention|number|figure|date|price list|attach|question|call/i.test(p) ? 'details'
            : /cost|value|benefit|price|argu|case|retain|save|concern/i.test(p) ? 'mainArguments' : 'secondaryArguments');
      const words = (s) => new Set(s.toLowerCase().match(/[a-z]{5,}/g) ?? []);
      const out = current.map((x) => ({ id: x.id, mergedFrom: [], topic: x.topic || topicFor(x.text), text: x.text, reason: x.reason, quote: '' }));
      const parts = said('New comment').split(/(?<=[.!?])\s+|,?\s+and\s+(?:also\s+)?/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
      for (const p of parts.slice(0, 3)) {
        // "X because Y" or "X, Y": Y is the reason.
        const [, ask = p, why = ''] = p.match(/^(.+?)(?:,?\s+because\s+|,\s+)(.+)$/i) ?? [];
        const reason = why ? cap(short(why.replace(/[.!?]+$/, ''))) : '';
        const topic = topicFor(p);
        const same = out.filter((x) => x.topic === topic);
        const near = same.find((x) => [...words(ask)].some((w) => words(x.text).has(w)))
          ?? (same.length >= config.ai.intents.maxPerTopic ? same.at(-1) : null);
        if (near) Object.assign(near, { text: cap(short(`${near.text} and ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`, 15)), reason: near.reason || reason, quote: p });
        else out.push({ id: '', mergedFrom: [], topic, text: cap(short(ask)), reason, quote: p });
      }
      return { data: { intents: out, removed: [] }, usage: null };
    },

    async health({ signal }) {
      await sleep(latency(), signal);
      return { ok: true, model: 'mock' };
    },
  };
}
