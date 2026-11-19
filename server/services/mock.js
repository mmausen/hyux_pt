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

// Customer reactions: canned texts by tone, picked for sentences of the actual draft (see structured()).
const REACTIONS = {
  money: [
    ['negative', 'I still can’t tell what this costs us, or what we get for it.'],
    ['negative', 'A number, but what does it mean for our budget?'],
  ],
  opening: [
    ['neutral', 'Polite, but every vendor opens like this.'],
    ['negative', 'This tells me nothing I didn’t already know.'],
  ],
  ask: [
    ['negative', 'This feels pushy. You want my time before you’ve earned it.'],
    ['neutral', 'So what exactly do you expect from me now?'],
  ],
  other: [
    ['positive', 'Clear. I understand what you mean here.'],
    ['neutral', 'I read this twice and I’m still not sure why it matters to us.'],
    ['positive', 'Good, this is the part that speaks to me.'],
    ['negative', 'This sounds like sales talk.'],
  ],
};

export function createMockService({ config }) {
  let t = 0;
  let r = 0;
  let asks = 0;
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
    // Intents and customer reactions without an LLM. Intents: one intent per sentence or "and"-clause of the comment (the part after
    // "because" or a comma is its reason); an annotation is appended to the intent. Good enough to
    // click through the intents mode.
    async structured({ kind, input, signal }) {
      await sleep(latency(), signal);
      const text = String(input.at(-1)?.content ?? '');
      // Customer: up to four sentences spread over the draft, each quoted exactly (its first words) with a
      // canned reaction that fits it (money, opening, a request, anything else). Varies from ask to ask.
      if (kind === 'customerReactions') {
        const draft = text.split('The draft you received:\n')[1] ?? '';
        const sentences = [...draft.matchAll(/[^.!?\n]+[.!?]?/g)].map((m) => m[0].trim())
          .filter((x) => x.split(/\s+/).length >= 5 && !/^\[.*\]$/.test(x));
        const n = Math.min(sentences.length, asks % 2 ? 3 : 4);
        const picked = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (sentences.length - 1)) / Math.max(1, n - 1))))].map((i) => sentences[i]);
        const k = asks++;
        return {
          data: {
            reactions: picked.map((sentence, i) => {
              const kind2 = /\d|price|cost|licen[cs]e|budget|fee/i.test(sentence) ? 'money'
                : i === 0 ? 'opening'
                  : /\?|please|let (?:me|us) know|call|meet|discuss/i.test(sentence) ? 'ask' : 'other';
              const pool = REACTIONS[kind2];
              const [tone, reaction] = pool[(k + i) % pool.length];
              const words = sentence.split(/\s+/);
              return { quote: words.slice(0, Math.min(words.length, 10)).join(' '), text: reaction, tone };
            }),
          },
          usage: null,
        };
      }
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
