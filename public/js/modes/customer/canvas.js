// Customer mode canvas ("Customer in the Room"). The AI plays the reader of the draft and only reacts; the
// participant judges how the text lands and decides what to change.
//
//   Start: the task's generic starting draft (task.scaffold, via /api/intents/start), as in the intents mode.
//   Ask Customer: the customer (a persona of the task, chosen above the margin) reads the latest draft and
//   returns two to five short first-person reactions, each tied to an exact passage and marked positive,
//   neutral or negative. They appear as cards in the margin, numbered, and their passages are highlighted
//   in the draft with the same numbers. A card can be switched on or off, and the participant can respond
//   to it by voice (hold its microphone); the transcript is shown on the card. The main record button adds
//   general instructions that are not tied to a reaction.
//   Send Changes hands the AI the latest draft, the reactions that are on (with the responses) and the
//   general instructions that are on; the response is the next version. The reactions of the previous
//   version then move into a collapsed "Earlier reactions" group, and the customer can be asked again.
//   Switching the persona affects only reactions asked for after that.
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }). Extra regions for the
// tour: persona, ask, reactions (the margin), reactionCard (the first card), notes.
// State lives on the server (session.rounds[round].customer, see server/routes/customer.js); a reload while
// the customer is reacting picks up the reactions when they arrive.
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
import { createLatestResponse, busy } from '../../core/canvas/latestResponse.js';
import { createControls } from '../../core/canvas/controls.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';

const errorKey = (e) => (e?.code === 'rate_limited' ? 'rateLimited' : e?.code === 'llm_timeout' || e?.name === 'TimeoutError' ? 'timeout' : null);
const TONE_ORDER = ['negative', 'neutral', 'positive']; // a passage with several reactions takes the first
const FALLBACK_PERSONA = { id: 'decision-maker', name: 'Decision-Maker', role: 'Busy decision-maker' };

// A reload or closed tab cuts running requests; that is not a failure to report.
let unloading = false;
addEventListener('beforeunload', () => { unloading = true; });
addEventListener('pagehide', () => { unloading = true; });

export function createCanvas(ctx, { round, task, live = true, conceal = false, sample = null, showFinish = true, onTurn = null, onRecorded = null }) {
  const { config, session } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';
  const aiTimeout = () => AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000);
  const personas = task?.personas?.length ? task.personas : [config.customer?.defaultPersona ?? FALLBACK_PERSONA];

  // ----- state -----
  const serverCust = () => session.data?.rounds?.[String(round)]?.customer ?? null;
  const emptyCust = () => ({ personaId: null, asks: [], reactions: [], notes: [] });
  let cust = sample ? sampleCust(sample) : (serverCust() ?? emptyCust());
  let asking = false;
  let askError = null; // { key, retry }
  let transcribing = false; // main record button
  const adding = []; // transcripts of general instructions being stored
  let inputError = null; // main recording or storing an instruction
  let personaError = null;
  let earlierOpen = false;
  let locked = !live;
  let destroyed = false;
  let pollTimer = null;
  let starting = false;
  let startError = false;
  const cards = new Map(); // reaction id → card
  const noteEls = new Map(); // note id → note item

  function sampleCust(s) {
    const c = s.customer ?? {};
    const p = personas[0];
    return {
      personaId: null,
      asks: [{ n: 1, personaId: p.id, turn: 1, status: 'done' }],
      reactions: (c.reactions ?? []).map((x, i) => ({
        id: `r${i + 1}`, ask: 1, turn: 1, personaId: p.id, personaName: p.name, start: -1, active: true, sentIn: [], ...x,
        responses: (x.responses ?? []).map((text) => ({ text })),
      })),
      notes: (c.notes ?? []).map((text, i) => ({ id: `g${i + 1}`, text, active: true, sentIn: [] })),
    };
  }

  // Keep the client copy of the session in step (a re-mount, e.g. after a dev mode switch, reads it).
  function remember() {
    if (!live || !session.data) return;
    const rounds = session.data.rounds ?? (session.data.rounds = {});
    const r = rounds[String(round)] ?? (rounds[String(round)] = { turns: [] });
    r.customer = cust;
  }

  const personaId = () => (personas.some((p) => p.id === cust.personaId) ? cust.personaId : personas[0].id);
  const personaOf = (id) => personas.find((p) => p.id === id) ?? personas[0];
  const hasDraft = () => conv.turns.length > 0;
  const latestN = () => conv.turns.at(-1)?.n ?? null;
  const latestText = () => conv.turns.at(-1)?.response ?? '';
  // Where a reaction's passage is in a text (-1: not found).
  const posIn = (r, text) => {
    if (!r.quote) return -1;
    if (r.start >= 0 && text.slice(r.start, r.start + r.quote.length) === r.quote) return r.start;
    return text.indexOf(r.quote);
  };
  const byPosition = (list, text) => list
    .map((r, i) => ({ r, i, p: posIn(r, text) }))
    .sort((a, b) => (a.p < 0 ? Infinity : a.p) - (b.p < 0 ? Infinity : b.p) || a.i - b.i)
    .map((x) => x.r);
  // Reactions to the latest version, in the order of their passages; earlier ones, newest version first.
  const currentReactions = () => byPosition(cust.reactions.filter((r) => r.turn === latestN()), latestText());
  const earlierReactions = () => cust.reactions.filter((r) => r.turn !== latestN()).sort((a, b) => b.turn - a.turn || b.ask - a.ask);
  const currentNotes = () => cust.notes.filter((x) => !x.sentIn?.length);
  const earlierNotes = () => cust.notes.filter((x) => x.sentIn?.length);
  const activeReactions = () => currentReactions().filter((r) => r.active);
  const activeNotes = () => currentNotes().filter((x) => x.active);
  const cardsBusy = () => [...cards.values()].some((c) => c.busy);
  const anyRecording = () => Boolean(input?.recording) || [...cards.values()].some((c) => c.input?.recording);

  const conv = createConversation(ctx, {
    round,
    live,
    sample: sample ? (sample.turns ?? []) : null,
    onUpdate: () => render(),
    onDelta: (text) => { if (!response.delta(text)) render(); },
    onTurn(turn, info) {
      response.markUpdated();
      if (turn.customer) {
        // The server recorded which reactions and instructions went into this version.
        const sent = new Set([...turn.customer.reactions, ...turn.customer.notes].map((x) => x.id));
        for (const x of [...cust.reactions, ...cust.notes]) if (sent.has(x.id) && !x.sentIn?.includes(turn.n)) x.sentIn = [...(x.sentIn ?? []), turn.n];
        remember();
      }
      onTurn?.(turn, info);
    },
  });

  // ----- layout -----
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const left = h('div');
  const scroller = h('div.vc-convo__scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, left);
  const side = h('div.ic-side');
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot, h('div.ic-layout.cu-layout', scroller, side));
  // Versions are counted from the first AI response; the starting draft has its own label.
  const versionOf = (n) => (conv.turns[0]?.kind === 'scaffold' ? n - 1 : n);
  const response = createLatestResponse({
    assistant: config.ai.assistantName, scroller, latest: conv.turns.at(-1),
    label: (turn) => (turn.kind === 'scaffold' ? t('canvas.scaffoldLabel') : turn.n ? t('canvas.versionLabel', { n: versionOf(turn.n) }) : null),
    decorate: (turn) => (turn.n === latestN() ? highlight(turn.response) : null),
  });
  const controls = createControls(ctx, { showFinish, sendLabelKey: 'customer.send' });
  const { recButton, sendBtn, finishBtn, timerSlot } = controls;
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  function errorStrip(err) {
    if (!err) return null;
    return h('div.ic-error', messageStrip('error', t(`canvas.errors.${err.key}`)),
      err.retry ? h('div', h('button.fh-btn', { type: 'button', onclick: err.retry }, t('common.retry'))) : null);
  }

  // ----- highlighted passages in the draft -----
  // Each reaction to the latest version marks its passage, with its number in front. Overlapping passages
  // are split into segments; a segment takes the tone of the reactions on it that are on.
  function highlight(text) {
    const list = currentReactions();
    const ranges = list.map((r, i) => ({ r, num: i + 1, start: posIn(r, text) }))
      .filter((x) => x.start >= 0)
      .map((x) => ({ ...x, end: x.start + x.r.quote.length }));
    if (!ranges.length) return null;
    const cuts = [...new Set([0, text.length, ...ranges.flatMap((x) => [x.start, x.end])])].sort((a, b) => a - b);
    const nodes = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      for (const x of ranges) {
        if (x.start === a) nodes.push(h('span.cu-num', { dataset: { tone: x.r.tone, reaction: x.r.id }, class: x.r.active ? '' : 'is-off', 'aria-hidden': 'true' }, String(x.num)));
      }
      const segment = text.slice(a, b);
      const cover = ranges.filter((x) => x.start <= a && x.end >= b);
      if (!cover.length) { nodes.push(segment); continue; }
      const on = cover.filter((x) => x.r.active);
      const tone = TONE_ORDER.find((tn) => (on.length ? on : cover).some((x) => x.r.tone === tn));
      nodes.push(h('mark.cu-mark', {
        dataset: { tone, reactions: cover.map((x) => x.r.id).join(' ') },
        class: on.length ? '' : 'is-off',
        title: cover.map((x) => `${x.num}. ${x.r.text}`).join('\n'),
      }, segment));
    }
    return nodes;
  }

  // Hovering a passage lights up its card and the other way round; selecting one shows the other.
  const marksOf = (id) => left.querySelectorAll(`.cu-mark[data-reactions~="${CSS.escape(id)}"], .cu-num[data-reaction="${CSS.escape(id)}"]`);
  function link(id, on) {
    marksOf(id).forEach((m) => m.classList.toggle('is-linked', on));
    cards.get(id)?.el.classList.toggle('is-linked', on);
  }
  const flash = (el) => { el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 1300); };
  function showPassage(id) {
    const first = marksOf(id)[0];
    if (!first) return;
    first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    marksOf(id).forEach(flash);
    logEvent('reaction.located', { id, from: 'card' });
  }
  function showCard(id) {
    const card = cards.get(id);
    if (!card) return;
    card.el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    flash(card.el);
    logEvent('reaction.located', { id, from: 'passage' });
  }
  const markIds = (target) => {
    const m = target.closest?.('.cu-mark, .cu-num');
    return m ? (m.dataset.reactions ?? m.dataset.reaction).split(' ') : [];
  };
  left.addEventListener('mouseover', (e) => markIds(e.target).forEach((id) => link(id, true)));
  left.addEventListener('mouseout', (e) => markIds(e.target).forEach((id) => link(id, false)));
  left.addEventListener('click', (e) => { const [id] = markIds(e.target); if (id) showCard(id); });

  // ----- reaction cards -----
  // A card keeps its DOM (and its recorder) across renders; render() only moves and updates it.
  function createCard(reaction) {
    const id = reaction.id;
    const numEl = h('span.cu-num.cu-card__num', { 'aria-hidden': 'true' });
    const toneText = h('span');
    const toneEl = h('span.cu-card__tone', toneText);
    const whoEl = h('span.cu-card__who');
    const metaEl = h('span.cu-card__meta');
    const textEl = h('p.cu-card__text');
    const quoteText = h('span');
    const quoteBtn = h('button.cu-card__quote', { type: 'button' }, quoteText);
    quoteBtn.addEventListener('click', () => showPassage(id));
    const quoteStatic = h('p.cu-card__quote.cu-card__quote--static');
    const responsesEl = h('ol.cu-card__responses');
    const toggle = h('input', { type: 'checkbox' });
    const check = h('label.fh-checkbox.ic-card__check', toggle, h('span.fh-checkbox__box'));
    const respondBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.ic-card__annotate', { type: 'button' }, icon('microphone'));
    const status = h('div.ic-card__status', { 'aria-live': 'polite' });
    const meterFill = h('span', { style: 'width:0%' });
    const meter = h('div.fh-progress.ic-card__meter', { 'aria-hidden': 'true' }, meterFill);
    const errorSlot = h('div');
    const el = h('li.ic-card.cu-card', { dataset: { reaction: id } },
      h('div.ic-card__row',
        check,
        h('div.ic-card__body', h('div.cu-card__head', numEl, toneEl, whoEl, metaEl), textEl, quoteBtn, quoteStatic, responsesEl),
        h('div.ic-card__side', respondBtn)),
      status,
      errorSlot);
    el.addEventListener('mouseenter', () => link(id, true));
    el.addEventListener('mouseleave', () => link(id, false));

    const card = { el, transcribing: false, responding: false, get busy() { return this.transcribing || this.responding; }, input: null, error: null, recording: false, responsesKey: null };

    toggle.addEventListener('change', async () => {
      const r = cust.reactions.find((x) => x.id === id);
      const active = toggle.checked;
      r.active = active;
      card.error = null;
      remember();
      logEvent('reaction.toggled', { id, active, tone: r.tone, responses: r.responses?.length ?? 0, activeCount: activeReactions().length });
      render();
      try {
        await api.customer.setActive(round, 'reactions', id, active);
      } catch (e) {
        if (destroyed) return;
        r.active = !active;
        card.error = { key: 'reactionToggle' };
        logEvent('reaction.toggleFailed', { id, error: e.code ?? e.name });
        remember();
        render();
      }
    });

    async function respond(text) {
      card.responding = true;
      card.error = null;
      conv.setBusy(`${id}:respond`, true);
      render();
      const started = performance.now();
      try {
        const res = await api.customer.respond(round, id, text, aiTimeout());
        if (destroyed) return;
        const i = cust.reactions.findIndex((x) => x.id === id);
        if (i >= 0) cust.reactions[i] = res.reaction;
        remember();
        // The response text is logged by the server (server.customer.responded).
        logEvent('reaction.responded', { id, chars: text.length, responses: res.reaction.responses.length, latencyMs: Math.round(performance.now() - started) });
      } catch (e) {
        if (destroyed || unloading) return;
        logEvent('reaction.respondFailed', { id, error: e.code ?? e.name });
        card.error = { key: 'reactionRespond', retry: () => respond(text) };
      } finally {
        card.responding = false;
        conv.setBusy(`${id}:respond`, false);
        if (!destroyed) render();
      }
    }

    if (live) {
      card.input = createVoiceInput(ctx, {
        round,
        button: respondBtn,
        keyboard: 'focus',
        log: { target: 'reaction', reactionId: id },
        busy: (key, on) => conv.setBusy(`${id}:${key}`, on),
        onStart() { card.error = null; card.recording = true; meterFill.style.width = '0%'; render(); },
        onLevel(level) { meterFill.style.width = `${Math.round(level * 100)}%`; },
        onStop() { card.recording = false; render(); },
        onTranscribing(on) { card.transcribing = on; render(); },
        onText(text) { onRecorded?.(); respond(text); },
        onFail(key, retry) { card.recording = false; card.error = { key, retry }; render(); },
      });
    }

    card.parts = { numEl, toneEl, toneText, whoEl, metaEl, textEl, quoteBtn, quoteText, quoteStatic, responsesEl, toggle, check, respondBtn, status, meter, errorSlot };
    return card;
  }

  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const showPersonas = personas.length > 1;

  function updateCard(card, r, { num = null, earlier = false } = {}) {
    const { numEl, toneEl, toneText, whoEl, metaEl, textEl, quoteBtn, quoteText, quoteStatic, responsesEl, toggle, check, respondBtn, status, meter, errorSlot } = card.parts;
    const inflight = Boolean(conv.inflight);
    const recording = card.recording;
    card.el.classList.toggle('is-off', !r.active);
    card.el.classList.toggle('is-busy', card.busy);
    card.el.classList.toggle('is-recording', recording);
    card.el.classList.toggle('is-earlier', earlier);
    card.el.dataset.tone = r.tone;

    numEl.hidden = !num;
    setText(numEl, num ? String(num) : '');
    numEl.dataset.tone = r.tone;
    setText(toneText, t(`customer.tone.${r.tone}`));
    toneEl.dataset.tone = r.tone;
    whoEl.hidden = !showPersonas && !earlier;
    setText(whoEl, r.personaName ?? personaOf(r.personaId).name);
    // Earlier reactions say which version they were about and whether they went into the next one.
    metaEl.hidden = !earlier;
    if (earlier) setText(metaEl, r.sentIn?.length ? t('customer.usedFor', { n: versionOf(r.sentIn.at(-1)) }) : t('customer.notUsed', { n: versionOf(r.turn) }));
    setText(textEl, r.text);

    // The passage: a link to it in the draft while it is highlighted there, plain text otherwise.
    const found = !earlier && posIn(r, latestText()) >= 0;
    quoteBtn.hidden = !found || !r.quote;
    quoteStatic.hidden = found || !r.quote;
    setText(quoteText, `“${r.quote}”`);
    setText(quoteStatic, `“${r.quote}”`);
    quoteBtn.title = t('customer.showPassage');

    const key = (r.responses ?? []).map((x) => x.text).join('\n');
    if (card.responsesKey !== key) {
      card.responsesKey = key;
      clear(responsesEl).append(...(r.responses ?? []).map((x) => h('li', h('span.cu-card__you', t('customer.you')), h('span', x.text))));
    }
    responsesEl.hidden = !r.responses?.length;

    check.hidden = earlier;
    toggle.checked = Boolean(r.active);
    toggle.disabled = locked || inflight || earlier;
    check.classList.toggle('fh-checkbox--disabled', toggle.disabled);
    toggle.setAttribute('aria-label', t('customer.useLabel', { text: r.text }));

    respondBtn.hidden = earlier;
    const canRespond = !locked && !inflight && !asking && !card.busy && (recording || !anyRecording());
    if (card.input && !earlier) {
      if (recording) respondBtn.disabled = locked;
      else card.input.setEnabled(canRespond);
    } else respondBtn.disabled = true;
    const action = recording && !ptt ? t('customer.respondStop') : t(ptt ? 'customer.respondHold' : 'customer.respondStart');
    respondBtn.title = action;
    respondBtn.setAttribute('aria-label', `${action}: ${r.text}`);

    clear(status);
    if (recording) status.append(h('span.app-sr-only', t('intents.recording')), meter);
    else if (card.transcribing) status.append(busy(t('canvas.transcribing')));
    else if (card.responding) status.append(busy(t('customer.addingResponse')));
    status.hidden = !status.firstChild;
    clear(errorSlot).append(errorStrip(card.error) ?? '');
  }

  // ----- general instructions -----
  function noteItem(note) {
    let item = noteEls.get(note.id);
    if (!item) {
      const toggle = h('input', { type: 'checkbox' });
      const check = h('label.fh-checkbox.ic-card__check', toggle, h('span.fh-checkbox__box'));
      const text = h('p.cu-note__text');
      const meta = h('span.cu-card__meta');
      const errorSlot = h('div');
      const el = h('li.ic-card.cu-note', { dataset: { note: note.id } }, h('div.ic-card__row.cu-note__row', check, h('div.ic-card__body', text, meta)), errorSlot);
      item = { el, toggle, check, text, meta, errorSlot, error: null };
      toggle.addEventListener('change', async () => {
        const n = cust.notes.find((x) => x.id === note.id);
        const active = toggle.checked;
        n.active = active;
        item.error = null;
        remember();
        logEvent('note.toggled', { id: n.id, active, activeCount: activeNotes().length });
        render();
        try {
          await api.customer.setActive(round, 'notes', n.id, active);
        } catch (e) {
          if (destroyed) return;
          n.active = !active;
          item.error = { key: 'reactionToggle' };
          remember();
          render();
        }
      });
      noteEls.set(note.id, item);
    }
    const earlier = Boolean(note.sentIn?.length);
    item.el.classList.toggle('is-off', !note.active);
    item.el.classList.toggle('is-earlier', earlier);
    setText(item.text, note.text);
    item.check.hidden = earlier;
    item.toggle.checked = Boolean(note.active);
    item.toggle.disabled = locked || Boolean(conv.inflight) || earlier;
    item.check.classList.toggle('fh-checkbox--disabled', item.toggle.disabled);
    item.toggle.setAttribute('aria-label', t('customer.useNoteLabel', { text: note.text }));
    item.meta.hidden = !earlier;
    if (earlier) setText(item.meta, t('customer.usedFor', { n: versionOf(note.sentIn.at(-1)) }));
    clear(item.errorSlot).append(errorStrip(item.error) ?? '');
    return item.el;
  }

  // ----- the margin -----
  const personaSelect = h('select', { 'aria-label': t('customer.personaLabel') },
    personas.map((p) => h('option', { value: p.id }, p.role ? `${p.name} (${p.role})` : p.name)));
  const personaField = h('label.fh-input.cu-persona__select', personaSelect, icon('slim-arrow-down', 'cu-persona__arrow'));
  const personaStatic = h('p.cu-persona__name');
  const personaAbout = h('p.cu-persona__about');
  const personaRow = h('div.cu-persona', { dataset: { region: 'persona' } },
    h('div.vc-instruction__label', t('customer.personaLabel')), showPersonas ? personaField : personaStatic, personaAbout);
  personaSelect.addEventListener('change', async () => {
    const from = personaId();
    const to = personaSelect.value;
    if (from === to) return;
    cust.personaId = to;
    personaError = null;
    remember();
    logEvent('customer.personaChanged', { from, to });
    render();
    try {
      await api.customer.setPersona(round, to);
    } catch (e) {
      if (destroyed) return;
      cust.personaId = from;
      personaError = { key: 'personaChange' };
      logEvent('customer.personaChangeFailed', { to, error: e.code ?? e.name });
      remember();
      render();
    }
  });

  const askLabel = h('span');
  const askBtn = h('button.fh-btn.cu-ask', { type: 'button', dataset: { region: 'ask' } }, icon('customer'), askLabel);
  askBtn.addEventListener('click', () => ask());

  const listHead = h('div.ic-panel__head.cu-section__head');
  const listEl = h('ol.ic-list');
  const notesHead = h('div.ic-panel__head.cu-section__head', h('div.vc-instruction__label', t('customer.notesLabel')));
  const notesList = h('ol.ic-list');
  const notesBody = h('div.cu-notes__body');
  const notesSection = h('section.cu-notes', { dataset: { region: 'notes' } }, notesHead, notesBody);
  // Reactions to older versions, and the instructions sent with them: a collapsed group at the bottom.
  const earlierList = h('ol.ic-list', { id: `cu-earlier-${round}` });
  const earlierLabel = h('span');
  const earlierToggle = h('button.fh-btn.fh-btn--transparent.ic-kept__toggle', { type: 'button', 'aria-controls': earlierList.id }, icon('slim-arrow-right', 'ic-kept__chevron'), earlierLabel);
  earlierToggle.addEventListener('click', () => {
    earlierOpen = !earlierOpen;
    logEvent('customer.earlierToggled', { open: earlierOpen, count: earlierList.children.length });
    render();
  });
  const earlier = h('div.ic-kept', earlierToggle, earlierList);
  const panelBody = h('div.ic-panel__body', { tabindex: '-1' });
  const panel = h('aside.ic-panel.cu-panel', { dataset: { region: 'reactions' }, 'aria-label': t('customer.panelLabel') },
    personaRow, askBtn, panelBody);

  function place(list, els) {
    const focused = document.activeElement;
    els.forEach((el, i) => { if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null); });
    while (list.children.length > els.length) list.lastElementChild.remove();
    if (focused && focused !== document.activeElement && document.contains(focused)) focused.focus({ preventScroll: true });
  }

  function renderPanel() {
    // Persona
    const persona = personaOf(personaId());
    personaSelect.value = persona.id;
    personaSelect.disabled = locked || asking;
    personaField.classList.toggle('is-disabled', personaSelect.disabled);
    setText(personaStatic, persona.role ? `${persona.name} (${persona.role})` : persona.name);
    setText(personaAbout, persona.about ?? '');
    personaAbout.hidden = !persona.about;

    // Ask
    const current = currentReactions();
    setText(askLabel, t(current.length ? 'customer.askAgain' : 'customer.ask'));
    askBtn.disabled = !canAsk();

    // Cards: those that exist; drop cards of reactions that are gone.
    for (const [id, card] of cards) {
      if (!cust.reactions.some((x) => x.id === id)) { card.input?.destroy(); card.el.remove(); cards.delete(id); }
    }
    const cardOf = (r) => {
      if (!cards.has(r.id)) cards.set(r.id, createCard(r));
      return cards.get(r.id);
    };
    const currentCards = current.map((r, i) => { const c = cardOf(r); updateCard(c, r, { num: i + 1 }); return c; });
    const older = earlierReactions();
    const olderCards = older.map((r) => { const c = cardOf(r); updateCard(c, r, { earlier: true }); return c; });
    // A card moving between the lists leaves its old one first.
    for (const c of currentCards) if (c.el.parentNode === earlierList) c.el.remove();
    for (const c of olderCards) if (c.el.parentNode === listEl) c.el.remove();
    place(listEl, currentCards.map((c) => c.el));

    const sentNotes = earlierNotes();
    for (const el of sentNotes.map(noteItem)) if (el.parentNode === notesList) el.remove();
    place(earlierList, [...olderCards.map((c) => c.el), ...sentNotes.map((x) => noteEls.get(x.id).el)]);
    const openNotes = currentNotes();
    for (const x of openNotes) { const el = noteItem(x); if (el.parentNode === earlierList) el.remove(); }
    place(notesList, openNotes.map((x) => noteEls.get(x.id).el));

    const earlierCount = older.length + sentNotes.length;
    earlier.hidden = !earlierCount;
    const earlierBusy = olderCards.some((c) => c.busy || c.recording);
    const showEarlier = earlierOpen || earlierBusy;
    earlierList.hidden = !showEarlier;
    earlierToggle.setAttribute('aria-expanded', String(showEarlier));
    earlierToggle.classList.toggle('is-open', showEarlier);
    earlierLabel.textContent = t('customer.earlier', { n: earlierCount });

    // Reactions to the latest version
    const top = [];
    if (asking) top.push(h('div.ic-pending', busy(t('customer.reading', { name: personaOf(lastAskPersona()).name }))));
    if (askError) top.push(errorStrip(askError));
    if (personaError) top.push(errorStrip(personaError));
    clear(listHead);
    if (current.length) {
      listHead.append(h('div.vc-instruction__label', t('customer.reactionsLabel', { version: versionLabel() })),
        h('span.ic-panel__count', t('customer.count', { active: current.filter((r) => r.active).length, total: current.length })));
    } else if (!asking && !askError && hasDraft()) {
      top.push(h('p.vc-draft__empty', t(earlierCount ? 'customer.emptyAgain' : 'customer.empty')));
    }

    // General instructions
    const noteTop = [];
    if (transcribing) noteTop.push(h('div.ic-pending', busy(t('canvas.transcribing'))));
    for (const text of adding) noteTop.push(h('div.ic-pending', busy(t('customer.addingNote')), h('q.ic-pending__text', text)));
    if (inputError) noteTop.push(errorStrip(inputError));
    const noNotes = !openNotes.length && !noteTop.length;
    if (noNotes) noteTop.push(h('p.vc-draft__empty', t(ptt ? 'customer.notesEmptyPushToTalk' : 'customer.notesEmptyToggle')));
    clear(notesBody).append(...noteTop, notesList);
    notesSection.classList.toggle('is-empty', noNotes);

    clear(panelBody).append(...top, listHead, listEl, notesSection, earlier);
    return panel;
  }
  const lastAskPersona = () => cust.asks.at(-1)?.personaId ?? personaId();
  const versionLabel = () => (conv.turns.at(-1)?.kind === 'scaffold' ? t('customer.startingDraft') : t('canvas.versionLabel', { n: versionOf(latestN()) }));

  // ----- render -----
  function render() {
    if (destroyed) return;
    const { inflight } = conv;
    const latest = conv.turns.at(-1);
    if (starting || startError) {
      clear(left).append(h('div.vc-turn__left', starting ? busy(t('canvas.scaffoldLoading')) : errorStrip({ key: 'scaffold', retry: start })));
      clear(side);
      renderControls();
      return;
    }
    clear(left).append(response.render({ inflight, latest, error: conv.error }));
    const right = renderPanel();
    if (side.firstChild !== right) clear(side).append(right);
    renderControls();
  }

  function canAsk() {
    return !locked && hasDraft() && !asking && !conv.inflight && !starting && !anyRecording();
  }

  function renderControls() {
    const inflight = Boolean(conv.inflight);
    const working = transcribing || adding.length > 0 || cardsBusy();
    const canRecord = !locked && !transcribing && !inflight && !starting && !startError && ![...cards.values()].some((c) => c.input?.recording);
    if (input) {
      if (input.recording) recButton.disabled = locked;
      else input.setEnabled(canRecord);
    } else recButton.disabled = true;
    const ready = hasDraft() ? activeReactions().length + activeNotes().length > 0 : activeNotes().length > 0;
    sendBtn.disabled = locked || starting || !ready || working || inflight || asking || anyRecording();
    finishBtn.disabled = locked;
  }

  // ----- asking the customer -----
  function adopt(askRec, reactions) {
    const i = cust.asks.findIndex((x) => x.n === askRec.n);
    if (i >= 0) cust.asks[i] = askRec;
    else cust.asks.push(askRec);
    for (const r of reactions) if (!cust.reactions.some((x) => x.id === r.id)) cust.reactions.push(r);
    remember();
  }
  const tones = (list) => Object.fromEntries(['positive', 'neutral', 'negative'].map((tn) => [tn, list.filter((r) => r.tone === tn).length]));

  async function ask() {
    if (!canAsk()) return;
    asking = true;
    askError = null;
    conv.clearError();
    conv.setBusy('ask', true);
    const persona = personaId();
    // The asks list gets the pending ask at once, so the "reading" line names the right persona.
    cust.asks.push({ n: cust.asks.length + 1, personaId: persona, turn: latestN(), status: 'pending', local: true });
    render();
    logEvent('customer.askStarted', { persona, version: versionOf(latestN()), currentReactions: currentReactions().length });
    const started = performance.now();
    try {
      const res = await api.customer.ask(round, aiTimeout());
      if (destroyed) return;
      cust.asks = cust.asks.filter((x) => !x.local);
      adopt(res.ask, res.reactions);
      // The reaction texts and passages are logged by the server (server.customer.reactions).
      logEvent('customer.reactionsReceived', {
        ask: res.ask.n, persona: res.ask.personaId, count: res.reactions.length, ids: res.reactions.map((r) => r.id), tones: tones(res.reactions),
        unanchored: res.reactions.filter((r) => r.start < 0).length, latencyMs: Math.round(performance.now() - started), mock: res.mock,
      });
    } catch (e) {
      if (destroyed || unloading) return;
      cust.asks = cust.asks.filter((x) => !x.local);
      logEvent('customer.askFailed', { error: e.code ?? e.name });
      askError = { key: e.code === 'busy' ? 'customerBusy' : errorKey(e) ?? 'customerAsk', retry: () => ask() };
    } finally {
      if (!unloading) {
        asking = false;
        conv.setBusy('ask', false);
        if (!destroyed) render();
      }
    }
  }

  // The page was reloaded while the customer was reacting: wait for the stored result.
  function resumeAsk() {
    const pending = cust.asks.at(-1);
    if (pending?.status !== 'pending') return;
    asking = true;
    conv.setBusy('ask', true);
    const deadline = Date.now() + (config.ai.timeoutSeconds + 30) * 1000;
    const poll = async () => {
      if (destroyed) return;
      let done = false;
      try {
        const data = await api.getSession();
        session.set(data);
        const fresh = data.rounds?.[String(round)]?.customer;
        const a = fresh?.asks?.find((x) => x.n === pending.n);
        if (a?.status === 'done') {
          cust = fresh;
          const got = cust.reactions.filter((r) => a.reactionIds.includes(r.id));
          logEvent('customer.reactionsReceived', { ask: a.n, persona: a.personaId, count: got.length, ids: a.reactionIds, tones: tones(got), resumed: true, latencyMs: a.latencyMs ?? null, mock: a.mock });
          done = true;
        } else if (!a || a.status === 'failed' || Date.now() > deadline) {
          if (fresh) cust = fresh;
          askError = { key: 'customerLost', retry: () => ask() };
          logEvent('customer.askFailed', { error: a?.error ?? 'lost', resumed: true });
          done = true;
        }
      } catch { /* try again */ }
      if (done) {
        asking = false;
        conv.setBusy('ask', false);
        render();
      } else pollTimer = setTimeout(poll, 1500);
    };
    logEvent('customer.askResumed', { ask: pending.n, persona: pending.personaId });
    pollTimer = setTimeout(poll, 800);
    render();
  }

  // ----- main recording: general instructions -----
  async function addNote(text) {
    adding.unshift(text);
    const busyKey = `note:${Math.random().toString(36).slice(2)}`;
    conv.setBusy(busyKey, true);
    render();
    const started = performance.now();
    try {
      const res = await api.customer.addNote(round, text, aiTimeout());
      if (destroyed) return;
      cust.notes.push(res.note);
      remember();
      // The text is logged by the server (server.customer.note).
      logEvent('note.added', { id: res.note.id, chars: text.length, latencyMs: Math.round(performance.now() - started) });
    } catch (e) {
      if (destroyed || unloading) return;
      logEvent('note.addFailed', { error: e.code ?? e.name });
      inputError = { key: 'noteAdd', retry: () => { inputError = null; addNote(text); } };
    } finally {
      adding.splice(adding.indexOf(text), 1);
      conv.setBusy(busyKey, false);
      if (!destroyed) render();
    }
  }

  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: recButton,
      log: { target: 'note' },
      busy: (key, on) => conv.setBusy(key, on),
      onStart() {
        inputError = null;
        conv.clearError();
        controls.recordingStarted();
        render();
      },
      onTick: controls.recordingTick,
      onLevel: controls.recordingLevel,
      onStop(rec) { controls.recordingStopped(rec); render(); },
      onTranscribing(on) {
        transcribing = on;
        if (on) { inputError = null; conv.clearError(); }
        render();
      },
      onText(text) { onRecorded?.(); addNote(text); },
      onFail(key, retry) {
        if (key === 'mic') controls.recordingStopped();
        inputError = { key, retry };
        render();
      },
    });
  }

  // ----- send changes -----
  async function send() {
    if (sendBtn.disabled) return;
    const reactions = hasDraft() ? activeReactions() : [];
    const notes = activeNotes();
    if (!reactions.length && !notes.length) return;
    askError = null;
    // Shown nowhere; the server builds and logs the full text (server.ai.request).
    const text = [...reactions.map((r) => `${r.text} ${(r.responses ?? []).map((x) => x.text).join(' ')}`), ...notes.map((x) => x.text)].join('\n');
    const all = currentReactions();
    await conv.send(text, {
      step: hasDraft() ? 'customer' : 'first',
      reactions: reactions.length, withResponse: reactions.filter((r) => r.responses?.length).length, off: all.length - reactions.length,
      tones: tones(reactions), notes: notes.length, reactionIds: reactions.map((r) => r.id), noteIds: notes.map((x) => x.id),
    }, { customer: { reactionIds: reactions.map((r) => r.id), noteIds: notes.map((x) => x.id) } });
  }
  sendBtn.addEventListener('click', send);

  // ----- starting draft -----
  async function start() {
    starting = true;
    startError = false;
    conv.setBusy('scaffold', true);
    render();
    try {
      const res = await api.intents.start(round);
      if (destroyed) return;
      if (res.turn) {
        conv.adopt(res.turn);
        logEvent('scaffold.shown', { chars: res.turn.response.length });
      }
    } catch (e) {
      if (destroyed) return;
      startError = true;
      logEvent('scaffold.failed', { error: e.code ?? e.name });
    } finally {
      starting = false;
      conv.setBusy('scaffold', false);
      if (!destroyed) render();
    }
  }

  // ----- assemble -----
  const el = h('div.vc.ic.cu', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls.el);
  render();
  if (live && !sample) resumeAsk();
  if (live && task?.scaffold && !conv.turns.length && !conv.inflight) start();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, record: recButton.parentElement, send: sendBtn, output: scroller, reactions: panel, persona: personaRow, ask: askBtn, notes: notesSection, timer: timerSlot, finish: finishBtn },
    getRegion(name) {
      if (name === 'reactionCard') return listEl.firstElementChild;
      return this.regions[name];
    },
    isBusy: () => conv.isBusy(),
    whenIdle: () => conv.whenIdle(),
    setLocked(on) {
      locked = on;
      render();
    },
    stopRecording(reason) {
      input?.stop(reason);
      for (const c of cards.values()) c.input?.stop(reason);
    },
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      input?.destroy();
      for (const c of cards.values()) c.input?.destroy();
      response.destroy();
      conv.destroy();
    },
  });
}
