// Canned speech-to-text and LLM, same interface as openai.js. Only reachable when DEV_MODE=true.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

const TRANSCRIPTS = [
  'Write in a casual tone, because we have a long-standing relationship.',
  'Stress continuity, because switching to a competitor costs time and money.',
  'Give an example of the nurses who rely on the platform every day.',
  'Make the tone of the email more professional.',
  'Hint at continuity subtly by bringing their IT department into the discussion.',
  'Actually, make the tone of the email friendly but professional.',
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
    async respond({ messages = [], onDelta, signal }) {
      await sleep(latency(), signal);
      // Slider mode: a text that follows from the decisions, so moving a slider changes it visibly.
      const input = String(messages.at(-1)?.content ?? '');
      const decisions = (input.split('Decisions:\n')[1] ?? '').split('\n\n')[0].trim();
      const text = decisions
        ? `Dear [Name of the CFO],\n\n${decisions.split('\n').map((l) => `This proposal is ${l.replace(/^- /, '').replace(/ \(“.*?”\):/, ':')}.`).join('\n\n')}\n\nKind regards,\n[Your name]`
        : RESPONSES[r++ % RESPONSES.length];
      if (onDelta) {
        for (const chunk of text.match(/\S+\s*/g) ?? []) {
          await sleep(25, signal);
          onDelta(chunk);
        }
      }
      return { text, usage: null };
    },
    // Intents without an LLM, good enough to click through the intents mode.
    // Collect: one intent per sentence or "and"-clause of the comment (the part after "because" or a
    // comma is its reason), placed in a group by keywords. A comment that starts with "actually",
    // "instead" or "no" revises the current intent of that group it shares a word with; "forget" or
    // "drop" takes it back. Structure: intents of a group that share a word are combined into one; the
    // rest stays. An annotation is appended to the intent.
    async structured({ kind, input, context = {}, signal }) {
      await sleep(latency(), signal);
      // Compare mode: two canned versions; then the pick with the annotation's words worked in, and a
      // profile that collects the annotations.
      if (kind === 'compareInitial') {
        return { data: { a: RESPONSES[0], b: RESPONSES[1], differences: ['A recaps the demo, B opens with a post of the customer'] }, usage: null };
      }
      if (kind === 'compareNext') {
        const said = String(context.annotation ?? '').replace(/[.!?]+$/, '');
        const paras = String(context.chosen ?? '').split('\n\n');
        paras.splice(Math.max(1, paras.length - 1), 0, `(Round ${context.step}: more of what you liked: ${said}.)`);
        return { data: { profile: [...(context.profile ?? []), `Likes: ${said}`].slice(-12), challenger: paras.join('\n\n'), differences: ['Adds one paragraph'] }, usage: null };
      }
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
      // Slider mode: "remove"/"delete"/"drop" removes the last slider; anything else creates a Tone slider.
      if (kind === 'sliderVoice') {
        const last = context.sliders?.at(-1);
        if (/\b(remove|delete|drop|get rid)\b/i.test(context.text ?? '') && last) return { data: { action: 'remove', id: last.id, theme: '', a: '', b: '' }, usage: null };
        return { data: { action: 'create', id: '', theme: 'Tone', a: 'Formal and reserved', b: 'Warm and personal' }, usage: null };
      }
      const text = String(input.at(-1)?.content ?? '');
      const said = (label) => (text.split(`${label}:\n`)[1] ?? '').split('\n\n')[0].trim();
      const short = (s, n = 6) => s.replace(/^(please|also|maybe|i want you to|can you|could you)\s+/i, '').split(/\s+/).slice(0, n).join(' ').replace(/[.,;:]+$/, '');
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      const json = (label) => { try { return JSON.parse(said(label) || '[]'); } catch { return []; } };
      const words = (s) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const shares = (a, b) => [...words(a)].some((w) => words(b).has(w));
      if (kind === 'annotateIntent') {
        const reason = said('Reason');
        return { data: { text: cap(short(`${said('Intent')}, ${said('Annotation')}`)), reason: reason === '(none given)' ? '' : reason }, usage: null };
      }
      if (kind === 'structureIntents') {
        const list = json('Intents that are on');
        const out = [];
        for (const x of list) {
          const into = out.find((y) => y.group === x.group && !/tone/i.test(x.group) && shares(y.text, x.text) && y.text.length + x.text.length < 120);
          if (into) {
            Object.assign(into, { text: cap(short(`${x.text}, ${into.text.charAt(0).toLowerCase()}${into.text.slice(1)}`, 8)), reason: into.reason || x.reason });
            into.mergedFrom.push(x.id);
          } else out.push({ id: x.id, mergedFrom: [], group: x.group, text: x.text, reason: x.reason, nuance: x.nuance });
        }
        // Components: argument order when there are two or more arguments; tone per passage when there
        // are two or more tones.
        const components = [];
        const args = out.filter((x) => /argument/i.test(x.group));
        if (args.length >= 2) components.push({ type: 'arguments', title: 'Order of the arguments', items: args.map((x) => ({ id: x.id, level: /main/i.test(x.group) ? 'main' : 'supporting' })), passages: [], options: [] });
        const tones = out.filter((x) => /tone/i.test(x.group)).map((x) => x.text).slice(0, 4);
        if (tones.length >= 2) components.push({ type: 'tones', title: 'Tone per passage', items: [], passages: [{ name: 'Opening', tone: tones[0] }, { name: 'Offer', tone: tones.at(-1) }, { name: 'Closing', tone: tones[0] }], options: tones });
        return { data: { groups: [...new Set(out.map((x) => x.group))], intents: out, components }, usage: null };
      }
      const current = json('Current intents');
      const groupFor = (p) => (/tone|formal|casual|friendl|personal|confiden|warm|polite|professional/i.test(p) ? 'Tone'
        : /short|longer|order|end with|start with|opening|closing|paragraph|sentences|structure|picks up/i.test(p) ? 'Structure'
          : /example|evidence|case study|data|survey|figures show/i.test(p) ? 'Supporting arguments'
            : /cost|value|benefit|argu|retain|save|concern|continuity|risk|effort/i.test(p) ? 'Main arguments' : 'Details');
      const comment = said('New comment');
      const data = { added: [], revised: [], removed: [] };
      const revising = /^(actually|instead|no[,.]?)\b/i.test(comment);
      const dropping = /^(forget|drop)\b/i.test(comment);
      if (revising || dropping) {
        const body = comment.replace(/^(actually|instead|no|forget|drop)[,.]?\s*/i, '');
        const hit = current.find((x) => x.group === groupFor(body) && shares(x.text, body)) ?? current.find((x) => shares(x.text, body));
        if (hit && dropping) { data.removed.push(hit.id); return { data, usage: null }; }
        if (hit) { data.revised.push({ id: hit.id, mergedFrom: [], group: hit.group, text: cap(short(body)), reason: hit.reason, nuance: hit.nuance, quote: comment }); return { data, usage: null }; }
      }
      const parts = comment.replace(/^(actually|instead|no|forget|drop)[,.]?\s*/i, '').split(/(?<=[.!?])\s+|,?\s+and\s+(?:also\s+)?/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2);
      for (const p of parts.slice(0, 3)) {
        // "X because Y" or "X, Y": Y is the reason.
        const [, ask = p, why = ''] = p.match(/^(.+?)(?:,?\s+because\s+|,\s+)(.+)$/i) ?? [];
        const nuance = /subtl|in passing|implicit/i.test(p) ? 'implicit' : '';
        data.added.push({ group: groupFor(p), text: cap(short(ask)), reason: why ? cap(short(why.replace(/[.!?]+$/, ''))) : '', nuance, quote: p });
      }
      return { data, usage: null };
    },

    async health({ signal }) {
      await sleep(latency(), signal);
      return { ok: true, model: 'mock' };
    },
  };
}
