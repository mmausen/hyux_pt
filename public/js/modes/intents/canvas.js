// Intents mode canvas. The participant still thinks aloud, but their words become intent cards that they
// can switch on and off and change by voice.
//
//   Layout (main-split): the task is a sidebar on the left (fold, resize, highlight). The work area on the
//   right is split by a divider: the draft in the upper half, the intent cards in the lower half, and the
//   microphone sits on the divider. The cards are sorted into collapsible topic sections (intent.topic);
//   the cards of a section stand next to each other.
//
//   Start: the task's generic starting draft (task.scaffold; the server stores it as turn 1, kind
//   'scaffold', via /api/intents/start). A task without one starts like the voice mode instead:
//   recordings build an instruction, which is sent as spoken and produces the first draft.
//   From then on: each recording is transcribed and split by the LLM into one or more intents, shown as
//   cards next to the draft (newest first). A card has the request, the participant's reason and their
//   own words (folded), a checkbox (on/off) and a hold-to-change microphone; an annotation is transcribed
//   and the LLM rewrites the intent (and its reason) on release. Send hands the AI only the active intents
//   (with their reasons) plus the latest draft (no history), which gives the next version. Cards stay;
//   each card shows whether it is new, changed or in the draft. New recordings add new cards.
//
// Same interface as the voice canvas (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }). Extra regions for the
// tour: intents (the card panel), intentCard (the first card).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t, raw } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskSidebar } from '../../core/canvas/taskSidebar.js';
import { createLatestResponse, busy } from '../../core/canvas/latestResponse.js';
import { createControls } from '../../core/canvas/controls.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const errorKey = (e) => (e?.code === 'rate_limited' ? 'rateLimited' : e?.code === 'llm_timeout' || e?.name === 'TimeoutError' ? 'timeout' : null);

export function createCanvas(ctx, { round, task, live = true, conceal = false, sample = null, showFinish = true, onTurn = null }) {
  const { config, session } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';
  const aiTimeout = () => AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000);

  // ----- state -----
  // Step 1 only: the instruction being built from recordings (as in the voice mode).
  let draft = sample ? (sample.draft && !sample.turns?.length ? [{ text: sample.draft }] : []) : [...(session.progress(round).draft ?? [])];
  let transcribing = false; // main record button
  let inputError = null; // { key, retry }: main recording, transcription or extraction
  let extracting = 0; // extractions running
  const finding = []; // their transcripts, shown while the intents are being found
  let noneFound = false; // the last recording held no intent
  let locked = !live;
  let destroyed = false;
  const serverIntents = () => session.data?.rounds?.[String(round)]?.intents ?? [];
  let starting = false; // loading the starting draft
  let startError = false;
  let intents = sample ? (sample.intents ?? []).map((x, i) => ({ id: `s${i + 1}`, active: true, annotations: [], sentIn: [], ...x })) : [...serverIntents()];
  const cards = new Map(); // id → card component

  const draftText = () => draft.map((d) => d.text).join(' ').trim();
  const saveDraft = () => live && session.updateProgress(round, { draft }, { immediate: true });
  const hasDraft = () => conv.turns.length > 0;
  const activeIntents = () => intents.filter((x) => x.active);
  const cardsBusy = () => [...cards.values()].some((c) => c.busy);
  const anyRecording = () => Boolean(input?.recording) || [...cards.values()].some((c) => c.input?.recording);

  // Keep the client copy of the session in step (a re-mount, e.g. after a dev mode switch, reads it).
  function remember() {
    if (!live || !session.data) return;
    const rounds = session.data.rounds ?? (session.data.rounds = {});
    const r = rounds[String(round)] ?? (rounds[String(round)] = { turns: [] });
    r.intents = intents;
  }

  const conv = createConversation(ctx, {
    round,
    live,
    // The tour shows the starting draft when the sample has one.
    sample: sample ? (sample.scaffold ? [{ n: 1, kind: 'scaffold', transcript: '', response: sample.scaffold, status: 'done', sentAt: sample.turns?.[0]?.sentAt, respondedAt: sample.turns?.[0]?.respondedAt }] : sample.turns ?? []) : null,
    onUpdate: () => render(),
    onDelta: (text) => { if (!response.delta(text)) render(); },
    onTurn(turn, info) {
      response.markUpdated();
      if (turn.intents) {
        // The server recorded which intents went into this version.
        for (const x of intents) if (turn.intents.some((s) => s.id === x.id) && !x.sentIn?.includes(turn.n)) x.sentIn = [...(x.sentIn ?? []), turn.n];
        remember();
      } else if (draftText() === turn.transcript) { draft = []; saveDraft(); }
      onTurn?.(turn, info);
    },
  });

  // ----- layout -----
  const sidebar = createTaskSidebar({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const left = h('div');
  const scroller = h('div.vc-convo__scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, left);
  const side = h('div.ic-side');
  const result = h('section.ics-result', { dataset: { region: 'output' } }, scroller);
  // Versions are counted from the first AI response; the starting draft has its own label.
  const versionOf = (n) => (conv.turns[0]?.kind === 'scaffold' ? n - 1 : n);
  const response = createLatestResponse({
    assistant: config.ai.assistantName, scroller, latest: conv.turns.at(-1),
    label: (turn) => (turn.kind === 'scaffold' ? t('canvas.scaffoldLabel') : turn.n ? t('canvas.versionLabel', { n: versionOf(turn.n) }) : null),
  });
  const controls = createControls(ctx, { showFinish, recInline: false });
  const { recButton, sendBtn, finishBtn, timerSlot } = controls;
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  // ----- step 1: the first instruction -----
  const clearBtn = h('button.fh-btn.fh-btn--transparent', { type: 'button', 'aria-label': t('canvas.clearLabel') }, icon('decline'), h('span', t('canvas.clear')));
  clearBtn.addEventListener('click', () => {
    const text = draftText();
    draft = [];
    inputError = null;
    saveDraft();
    logEvent('draft.cleared', { text });
    render();
  });

  function errorStrip(err) {
    if (!err) return null;
    return h('div.ic-error', messageStrip('error', t(`canvas.errors.${err.key}`)),
      err.retry ? h('div', h('button.fh-btn', { type: 'button', onclick: err.retry }, t('common.retry'))) : null);
  }

  function draftBlock() {
    const text = draftText();
    const box = h('aside.vc-instruction.vc-draft', { dataset: { region: 'transcript' }, 'aria-live': 'polite' },
      h('div.vc-draft__head', h('div.vc-instruction__label', t('canvas.draftLabel')), clearBtn));
    clearBtn.disabled = locked || !text || transcribing;
    box.append(text ? h('p.vc-instruction__text', text) : h('p.vc-draft__empty', t(ptt ? 'canvas.draftEmptyPushToTalk' : 'canvas.draftEmptyToggle')));
    if (transcribing) box.append(busy(t('canvas.transcribing')));
    box.append(errorStrip(inputError) ?? '');
    return box;
  }

  function instructionBlock(turn) {
    return h('aside.vc-instruction',
      h('div.vc-instruction__label', t('canvas.instructionLabel')),
      h('p.vc-instruction__text', turn.transcript),
      turn.sentAt ? h('div.vc-instruction__time', t('canvas.sentAt', { time: timeOf(turn.sentAt) })) : null);
  }

  // ----- intent cards -----
  // A card shows the request, the participant's reason ("Why") and, folded, their own words. A card keeps
  // its DOM (and its recorder) across renders; render() only moves and updates it.
  // State of an intent: 'new' (never sent), 'changed' (changed by voice since it was last sent),
  // 'applied' (sent in the latest version and unchanged since: it is in the draft) or 'earlier' (last sent
  // in an older version, e.g. it was off when the latest version was written). Applied cards go into a
  // collapsed group under the others, so what is new stays in view. Switching a card on or off never
  // moves it; a change by voice moves an applied card back up.
  function stateOf(intent) {
    const n = intent.sentIn?.at(-1);
    if (!n) return 'new';
    const sentAt = conv.turns.find((x) => x.n === n)?.sentAt;
    if (sentAt && (intent.annotations ?? []).some((a) => a.at > sentAt)) return 'changed';
    return n === conv.turns.at(-1)?.n ? 'applied' : 'earlier';
  }
  const stateLabel = (intent, state) => (state === 'new' ? t('intents.tagNew') : state === 'changed' ? t('intents.tagChanged') : t('intents.tagSent', { n: versionOf(intent.sentIn.at(-1)) }));

  function createCard(intent) {
    const id = intent.id;
    const textEl = h('p.ic-card__text');
    const reasonText = h('span');
    const reasonEl = h('p.ic-card__reason', h('span.ic-card__why', t('intents.why')), reasonText);
    const quoteText = h('q');
    const quoteEl = h('details.ic-card__quote', h('summary', t('intents.yourWords')), h('p', quoteText));
    quoteEl.addEventListener('toggle', () => logEvent('intent.quoteToggled', { id, open: quoteEl.open }));
    const stateText = h('span');
    const stateEl = h('span.ic-card__state', h('span.ic-card__dot', { 'aria-hidden': 'true' }), stateText);
    const toggle = h('input', { type: 'checkbox' });
    const check = h('label.fh-checkbox.ic-card__check', toggle, h('span.fh-checkbox__box'));
    const annotateBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.ic-card__annotate', { type: 'button' }, icon('microphone'));
    const status = h('div.ic-card__status', { 'aria-live': 'polite' });
    const errorSlot = h('div');
    const el = h('li.ic-card', { dataset: { intent: id } },
      h('div.ic-card__row',
        check,
        h('div.ic-card__body', textEl, reasonEl, quoteEl),
        h('div.ic-card__side', stateEl, annotateBtn)),
      status,
      errorSlot);

    // transcribing: the annotation is being converted to text; annotating: the LLM rewrites the intent.
    const card = { el, transcribing: false, annotating: false, get busy() { return this.transcribing || this.annotating; }, input: null, error: null, recordingSeconds: null };

    toggle.addEventListener('change', async () => {
      const intentNow = intents.find((x) => x.id === id);
      const active = toggle.checked;
      intentNow.active = active;
      card.error = null;
      remember();
      logEvent('intent.toggled', { id, active, activeCount: activeIntents().length, state: stateOf(intentNow) });
      render();
      try {
        await api.intents.setActive(round, id, active);
      } catch (e) {
        if (destroyed) return;
        intentNow.active = !active;
        card.error = { key: 'intentToggle' };
        logEvent('intent.toggleFailed', { id, error: e.code ?? e.name });
        remember();
        render();
      }
    });

    async function annotate(text) {
      card.annotating = true;
      card.error = null;
      conv.setBusy(`${id}:annotate`, true);
      render();
      const started = performance.now();
      try {
        const res = await api.intents.annotate(round, id, text, aiTimeout());
        if (destroyed) return;
        const i = intents.findIndex((x) => x.id === id);
        if (i >= 0) intents[i] = res.intent;
        remember();
        // The annotation and the before/after texts are logged by the server (server.intent.annotated).
        logEvent('intent.annotated', { id, latencyMs: Math.round(performance.now() - started), mock: res.mock });
      } catch (e) {
        if (destroyed) return;
        logEvent('intent.annotateFailed', { id, error: e.code ?? e.name });
        card.error = { key: errorKey(e) ?? 'intentAnnotate', retry: () => annotate(text) };
      } finally {
        card.annotating = false;
        conv.setBusy(`${id}:annotate`, false);
        if (!destroyed) render();
      }
    }

    if (live) {
      card.input = createVoiceInput(ctx, {
        round,
        button: annotateBtn,
        keyboard: 'focus',
        log: { target: 'intent', intentId: id },
        busy: (key, on) => conv.setBusy(`${id}:${key}`, on),
        onStart() { card.error = null; card.recordingSeconds = 0; render(); },
        onTick(s) { card.recordingSeconds = Math.floor(s); updateCard(card, intents.find((x) => x.id === id)); },
        onStop() { card.recordingSeconds = null; render(); },
        onTranscribing(on) { card.transcribing = on; render(); },
        onText(text) { annotate(text); }, // marks itself busy at once
        onFail(key, retry) { card.recordingSeconds = null; card.error = { key, retry }; render(); },
      });
    }

    card.parts = { textEl, reasonEl, reasonText, quoteEl, quoteText, stateEl, stateText, toggle, check, annotateBtn, status, errorSlot };
    return card;
  }

  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function updateCard(card, intent) {
    const { textEl, reasonEl, reasonText, quoteEl, quoteText, stateEl, stateText, toggle, check, annotateBtn, status, errorSlot } = card.parts;
    const inflight = Boolean(conv.inflight);
    const recording = card.recordingSeconds !== null;
    const state = stateOf(intent);
    card.el.classList.toggle('is-off', !intent.active);
    card.el.classList.toggle('is-busy', card.busy);
    card.el.classList.toggle('is-recording', recording);
    card.el.dataset.state = state;

    setText(textEl, intent.text);
    reasonEl.hidden = !intent.reason;
    setText(reasonText, intent.reason ?? '');
    const quote = intent.quote || intent.transcript || '';
    quoteEl.hidden = !quote;
    setText(quoteText, quote);

    // An applied card sits in the "In the draft" group, which already says so: the dot is enough.
    const label = stateLabel(intent, state);
    setText(stateText, label);
    stateText.className = state === 'applied' ? 'app-sr-only' : '';
    stateEl.title = label;

    toggle.checked = Boolean(intent.active);
    toggle.disabled = locked || inflight;
    check.classList.toggle('fh-checkbox--disabled', toggle.disabled);
    toggle.setAttribute('aria-label', t('intents.useLabel', { text: intent.text }));

    const canAnnotate = !locked && !inflight && !card.busy && (recording || !anyRecording());
    if (card.input) {
      if (recording) annotateBtn.disabled = locked;
      else card.input.setEnabled(canAnnotate);
    } else annotateBtn.disabled = true;
    const action = recording && !ptt ? t('intents.annotateStop') : t(ptt ? 'intents.annotateHold' : 'intents.annotateStart');
    annotateBtn.title = action;
    annotateBtn.setAttribute('aria-label', `${action}: ${intent.text}`);

    clear(status);
    if (recording) status.append(t('canvas.recordingStatus', { seconds: card.recordingSeconds }));
    else if (card.busy) status.append(busy(t('intents.updating')));
    status.hidden = !status.firstChild;
    clear(errorSlot).append(errorStrip(card.error) ?? '');
  }

  // Topic sections: one collapsible section per topic, its cards next to each other. A topic is the
  // intent's `topic` (empty: not sorted yet). Known topics come first in a fixed order (strings:
  // intents.topicLabels); any other topic follows in the order it appeared.
  const topicLabels = raw('intents.topicLabels') ?? {};
  const topicOrder = Object.keys(topicLabels);
  const topicOf = (intent) => (typeof intent.topic === 'string' ? intent.topic.trim() : '');
  const topicName = (key) => (key === '' ? t('intents.topicUnsorted') : topicLabels[key] ?? key);
  const sections = new Map(); // topic → section
  const folded = new Set(); // topics the participant has folded
  const topics = h('div.ic-topics');

  function createSection(key) {
    const list = h('ol.ic-list.ic-grid', { id: `ic-topic-${round}-${sections.size}` });
    const name = h('span.ic-topic__name');
    const count = h('span.ic-topic__count');
    const toggle = h('button.ic-topic__toggle', { type: 'button', 'aria-controls': list.id }, icon('slim-arrow-down', 'ic-topic__chevron'), name, count);
    toggle.addEventListener('click', () => {
      const open = folded.has(key);
      if (open) folded.delete(key); else folded.add(key);
      logEvent('intents.topicToggled', { topic: key, open, count: list.children.length });
      render();
    });
    const el = h('section.ic-topic', { dataset: { topic: key } }, h('h3.ic-topic__head', toggle), list);
    return { el, list, name, count, toggle };
  }

  const panelCount = h('span.ic-panel__count');
  const panelBody = h('div.ic-panel__body', { tabindex: '-1' });
  const panel = h('aside.ic-panel', { dataset: { region: 'intents' }, 'aria-label': t('intents.panelLabel') },
    h('div.ic-panel__head', h('div.vc-instruction__label', t('intents.panelLabel')), panelCount),
    panelBody);

  // Puts the elements into a container in this order, moving only those that are out of place. Moving an
  // element takes the focus away from it, so the focus is put back.
  function place(container, ordered) {
    const focused = document.activeElement;
    ordered.forEach((el, i) => {
      if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
    });
    while (container.children.length > ordered.length) container.lastElementChild.remove();
    if (focused && focused !== document.activeElement && document.contains(focused)) focused.focus({ preventScroll: true });
  }

  function renderPanel() {
    const active = activeIntents().length;
    panelCount.textContent = intents.length ? t('intents.count', { active, total: intents.length }) : '';
    // Cards for intents that exist; drop cards of intents that are gone.
    for (const [id, card] of cards) {
      if (!intents.some((x) => x.id === id)) { card.input?.destroy(); card.el.remove(); cards.delete(id); }
    }
    const groups = new Map(); // topic → cards, newest first
    for (const intent of [...intents].reverse()) {
      if (!cards.has(intent.id)) cards.set(intent.id, createCard(intent));
      const card = cards.get(intent.id);
      updateCard(card, intent);
      const key = topicOf(intent);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ card, intent });
    }
    const rank = (key) => (key === '' ? -1 : topicOrder.includes(key) ? topicOrder.indexOf(key) : topicOrder.length);
    const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b)); // the sort is stable: other topics keep their order
    for (const [key, section] of sections) if (!groups.has(key)) { section.el.remove(); sections.delete(key); }
    const ordered = [];
    for (const key of keys) {
      if (!sections.has(key)) sections.set(key, createSection(key));
      const section = sections.get(key);
      const members = groups.get(key);
      const on = members.filter((m) => m.intent.active).length;
      // A recording or a change running in a section keeps it open.
      const working = members.some((m) => m.card.busy || m.card.recordingSeconds !== null);
      const open = !folded.has(key) || working;
      setText(section.name, topicName(key));
      setText(section.count, t('intents.count', { active: on, total: members.length }));
      section.list.hidden = !open;
      section.toggle.setAttribute('aria-expanded', String(open));
      section.toggle.classList.toggle('is-open', open);
      place(section.list, members.map((m) => m.card.el));
      ordered.push(section.el);
    }
    place(topics, ordered);

    const top = [];
    if (transcribing) top.push(h('div.ic-pending', busy(t('canvas.transcribing'))));
    // What the participant said appears at once, while the intents are being found in it.
    for (const text of finding) top.push(h('div.ic-pending', busy(t('intents.finding')), h('q.ic-pending__text', text)));
    if (inputError) top.push(errorStrip(inputError));
    if (noneFound && !extracting && !transcribing) top.push(messageStrip('information', t('intents.noneFound')));
    const idle = !extracting && !transcribing;
    if (!intents.length && idle) top.push(h('p.vc-draft__empty', t(ptt ? 'intents.emptyPushToTalk' : 'intents.emptyToggle')));
    clear(panelBody).append(...top, topics);
    return panel;
  }

  // The send button says what goes into the next version: intents not in the draft yet, and those kept.
  function sendLabel() {
    const active = activeIntents();
    const keptN = active.filter((x) => stateOf(x) === 'applied').length;
    const newN = active.length - keptN;
    if (newN && keptN) return ['intents.sendNewKept', { new: newN, kept: keptN }];
    if (newN) return [newN === 1 ? 'intents.sendOneNew' : 'intents.sendNew', { new: newN }];
    if (keptN) return ['intents.sendKept', { kept: keptN }];
    return ['intents.send'];
  }

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
    // Lower half: before the first draft the instruction (being recorded or being answered); after it,
    // the intent cards.
    const right = !hasDraft() && !(inflight && intents.length)
      ? (inflight ? instructionBlock(inflight) : draftBlock())
      : renderPanel();
    if (side.firstChild !== right) clear(side).append(right);
    controls.setSendLabel(...(hasDraft() ? sendLabel() : ['canvas.send']));
    renderControls();
  }

  function renderControls() {
    const inflight = Boolean(conv.inflight);
    const working = transcribing || extracting > 0 || cardsBusy();
    const canRecord = !locked && !transcribing && !inflight && !starting && !startError && !anyRecordingOtherThanMain();
    if (input) {
      if (input.recording) recButton.disabled = locked;
      else input.setEnabled(canRecord);
    } else recButton.disabled = true;
    const ready = hasDraft() ? activeIntents().length > 0 : Boolean(draftText());
    sendBtn.disabled = locked || starting || !ready || working || inflight || anyRecording();
    finishBtn.disabled = locked;
  }
  const anyRecordingOtherThanMain = () => [...cards.values()].some((c) => c.input?.recording);

  // ----- main recording: first instruction, then new intents -----
  async function extract(text) {
    extracting++;
    finding.unshift(text);
    noneFound = false;
    const busyKey = `extract:${Math.random().toString(36).slice(2)}`;
    conv.setBusy(busyKey, true);
    render();
    const started = performance.now();
    try {
      const res = await api.intents.extract(round, text, aiTimeout());
      if (destroyed) return;
      intents.push(...res.intents);
      noneFound = res.intents.length === 0;
      remember();
      // The transcript and the intent texts are logged by the server (server.intents.extracted).
      logEvent('intents.extracted', { count: res.intents.length, ids: res.intents.map((x) => x.id), latencyMs: Math.round(performance.now() - started), mock: res.mock });
    } catch (e) {
      if (destroyed) return;
      logEvent('intents.extractFailed', { error: e.code ?? e.name });
      inputError = { key: errorKey(e) ?? 'intentsExtract', retry: () => { inputError = null; extract(text); } };
    } finally {
      extracting--;
      finding.splice(finding.indexOf(text), 1);
      conv.setBusy(busyKey, false);
      if (!destroyed) render();
    }
  }

  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: recButton,
      // 'instruction': builds the first instruction; 'intents': becomes new intent cards.
      log: () => ({ target: hasDraft() ? 'intents' : 'instruction' }),
      busy: (key, on) => conv.setBusy(key, on),
      onStart() {
        inputError = null;
        noneFound = false;
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
      onText(text, rec) {
        if (hasDraft()) { extract(text); return; } // marks itself busy at once
        draft.push({ text, at: new Date().toISOString(), recordingMs: rec.durationMs });
        saveDraft();
      },
      onFail(key, retry) {
        if (key === 'mic') controls.recordingStopped();
        inputError = { key, retry };
        render();
      },
    });
  }

  // ----- send to AI -----
  async function send() {
    if (locked || conv.inflight || transcribing) return;
    if (!hasDraft()) {
      const text = draftText();
      if (!text) return;
      await conv.send(text, { segments: draft.length, step: 'first' });
      return;
    }
    const active = activeIntents();
    if (!active.length) return;
    noneFound = false;
    await conv.send(active.map((x) => `- ${x.text}${x.reason ? ` (why: ${x.reason})` : ''}`).join('\n'),
      { step: 'intents', intents: active.length, intentIds: active.map((x) => x.id), inactive: intents.length - active.length, kept: active.filter((x) => stateOf(x) === 'applied').length },
      { intentIds: active.map((x) => x.id) });
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
  // The microphone sits on the line between the draft (above) and the intents (below).
  const divider = h('div.ics-divider', controls.rec);
  const work = h('div.ics-work', noticeSlot, result, divider, h('section.ics-intents', side));
  const el = h('div.vc.ic.ics', { class: live ? '' : 'vc--static' }, sidebar.el, work, controls.el);
  render();
  if (live && task?.scaffold && !conv.turns.length && !conv.inflight) start();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: sidebar.el, record: recButton.parentElement, send: sendBtn, output: scroller, intents: panel, timer: timerSlot, finish: finishBtn },
    getRegion(name) {
      if (name === 'transcript') return el.querySelector('[data-region="transcript"]');
      if (name === 'intentCard') return topics.querySelector('.ic-card');
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
      input?.destroy();
      for (const c of cards.values()) c.input?.destroy();
      response.destroy();
      sidebar.destroy();
      conv.destroy();
    },
  });
}
