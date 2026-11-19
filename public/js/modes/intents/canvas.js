// Intents mode canvas. The participant thinks aloud, and their words become intents: the building blocks
// of the text, which they can switch on and off, change by voice and delete.
//
//   Layout (main-split): the task is a sidebar on the left (fold, resize, highlight). The work area on the
//   right is split by a divider: the draft in the upper half, the intents in the lower half, and the
//   microphone sits on the divider. The intents are grouped (intent.group, generative): a row of
//   colour-coded groups, and under it the cards of the open group, next to each other.
//
//   Start: the task's generic starting draft (task.scaffold; the server stores it as turn 1, kind
//   'scaffold', via /api/intents/start). A task without one starts like the voice mode instead:
//   recordings build an instruction, which is sent as spoken and produces the first draft.
//   From then on the work goes in rounds of collect, structure and generate:
//   Collect: each recording is transcribed and its intents are added (/api/intents/collect). A recording
//   changes or merges existing cards only when it clearly revises them; those cards play an update
//   animation, and the last recording (or change by voice) can be undone.
//   Structure and generate: Write Version brings all active intents into one plan (they may be combined,
//   reworded and regrouped; the cards change to it on screen) and then writes the text anew from the
//   starting draft and that plan, so the cards show what the version is built from.
//
// Same interface as the voice canvas (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }). Extra regions for the
// tour: intents (the card panel), intentCard (the first card).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
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
  let inputError = null; // { key, retry }: main recording, transcription, collecting, deleting or undo
  let synthesizing = 0; // recordings being collected, running or waiting (they run one after the other)
  let structuring = false; // Write Version is bringing the intents into a plan
  let lastUndo = null; // { token, kind, changes }: the last recording or change by voice, which can be undone
  let queue = Promise.resolve();
  const finding = []; // their transcripts, shown while they are being collected
  let noneFound = false; // the last recording held no intent
  const fresh = new Set(); // intents the last recording added or changed (highlighted for a moment)
  let freshTimer = null;
  let locked = !live;
  let destroyed = false;
  const serverIntents = () => session.data?.rounds?.[String(round)]?.intents ?? [];
  let starting = false; // loading the starting draft
  let startError = false;
  let intents = sample ? (sample.intents ?? []).map((x, i) => ({ id: `s${i + 1}`, active: true, annotations: [], sentIn: [], ...x })) : [...serverIntents()];
  let openGroup; // the open group; null: all closed; undefined: not chosen yet
  // Order of the groups and their accent colours, kept by the server (rounds[round].groups / .accents).
  let groupOrder = sample ? [] : [...(session.data?.rounds?.[String(round)]?.groups ?? [])];
  let accents = sample ? {} : { ...(session.data?.rounds?.[String(round)]?.accents ?? {}) };
  const takeGroups = (res) => { if (res?.groups) groupOrder = res.groups; if (res?.accents) accents = res.accents; };
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
    r.groups = groupOrder;
    r.accents = accents;
  }

  const conv = createConversation(ctx, {
    round,
    live,
    // The tour shows the starting draft when the sample has one.
    sample: sample ? (sample.scaffold ? [{ n: 1, kind: 'scaffold', transcript: '', response: sample.scaffold, status: 'done', sentAt: sample.turns?.[0]?.sentAt, respondedAt: sample.turns?.[0]?.respondedAt }] : sample.turns ?? []) : null,
    onUpdate: () => render(),
    onDelta: (text) => { if (!response.delta(text)) render(); },
    // Write Version: the intents, brought into the plan the version is written from.
    onEvent(msg) {
      if (msg.type === 'structuring') { structuring = true; render(); return; }
      if (msg.type !== 'intents') return;
      structuring = false;
      intents = msg.intents;
      takeGroups(msg);
      showChanges(msg.changes);
      remember();
      logEvent('intents.structured', { ...countChanges(msg.changes), active: activeIntents().length, failed: !msg.changes || undefined });
      render();
    },
    onTurn(turn, info) {
      response.markUpdated();
      if (info?.resumed && turn.intents) {
        // Reloaded while the version was written: the plan is in the session.
        intents = [...serverIntents()];
        groupOrder = [...(session.data?.rounds?.[String(round)]?.groups ?? groupOrder)];
        accents = { ...(session.data?.rounds?.[String(round)]?.accents ?? accents) };
      }
      structuring = false;
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
    label: (turn) => (turn.kind === 'scaffold' ? t('canvas.scaffoldLabel')
      : turn.intents?.length ? t(turn.intents.length === 1 ? 'intents.versionFromOne' : 'intents.versionFrom', { n: versionOf(turn.n), count: turn.intents.length })
        : turn.n ? t('canvas.versionLabel', { n: versionOf(turn.n) }) : null),
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
  // State of an intent: 'new' (not in a version yet), 'changed' (changed by a recording or by voice since
  // the version it is in), 'applied' (sent in the latest version and unchanged since: it is in the draft) or 'earlier'
  // (last sent in an older version, e.g. it was off when the latest version was written).
  function stateOf(intent) {
    const n = intent.sentIn?.at(-1);
    if (!n) return 'new';
    // The plan of a version is made after it was sent, so a change counts from when the version was done.
    const turn = conv.turns.find((x) => x.n === n);
    const since = turn?.respondedAt ?? turn?.sentAt;
    if (since && (intent.updatedAt > since || (intent.annotations ?? []).some((a) => a.at > since))) return 'changed';
    return n === conv.turns.at(-1)?.n ? 'applied' : 'earlier';
  }
  const stateLabel = (intent, state) => (state === 'new' ? t('intents.tagNew') : state === 'changed' ? t('intents.tagChanged') : t('intents.tagSent', { n: versionOf(intent.sentIn.at(-1)) }));
  const quotesOf = (x) => (Array.isArray(x.quotes) ? x.quotes : [x.quote || x.transcript || ''].filter(Boolean));

  function createCard(intent) {
    const id = intent.id;
    const textEl = h('p.ic-card__text');
    const nuanceEl = h('span.ic-card__nuance');
    const reasonText = h('span');
    const reasonEl = h('p.ic-card__reason', h('span.ic-card__why', t('intents.why')), reasonText);
    const quoteText = h('div.ic-card__quotes');
    const quoteEl = h('details.ic-card__quote', h('summary', t('intents.yourWords')), quoteText);
    quoteEl.addEventListener('toggle', () => logEvent('intent.quoteToggled', { id, open: quoteEl.open }));
    const stateText = h('span');
    const stateEl = h('span.ic-card__state', h('span.ic-card__dot', { 'aria-hidden': 'true' }), stateText);
    const toggle = h('input', { type: 'checkbox' });
    const check = h('label.fh-checkbox.ic-card__check', toggle, h('span.fh-checkbox__box'));
    const annotateBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.ic-card__annotate', { type: 'button' }, icon('microphone'));
    const deleteBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.ic-card__delete', { type: 'button' }, icon('decline'));
    const status = h('div.ic-card__status', { 'aria-live': 'polite' });
    const errorSlot = h('div');
    const el = h('li.ic-card', { dataset: { intent: id } },
      h('div.ic-card__row',
        check,
        h('div.ic-card__body', nuanceEl, textEl, reasonEl, quoteEl),
        h('div.ic-card__side', stateEl, h('div.ic-card__tools', annotateBtn, deleteBtn))),
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

    deleteBtn.addEventListener('click', async () => {
      const i = intents.findIndex((x) => x.id === id);
      if (i < 0) return;
      const [gone] = intents.splice(i, 1);
      inputError = null;
      remember();
      logEvent('intent.deleted', { id, active: gone.active, state: stateOf(gone), remaining: intents.length });
      render();
      try {
        await api.intents.remove(round, id);
      } catch (e) {
        if (destroyed) return;
        intents.splice(Math.min(i, intents.length), 0, gone);
        inputError = { key: 'intentDelete' };
        logEvent('intent.deleteFailed', { id, error: e.code ?? e.name });
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
        lastUndo = res.undoToken ? { token: res.undoToken, kind: 'annotation', changes: { updated: [id] } } : null;
        showChanges({ updated: [id] });
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

    card.parts = { textEl, nuanceEl, reasonEl, reasonText, quoteEl, quoteText, stateEl, stateText, toggle, check, annotateBtn, deleteBtn, status, errorSlot };
    return card;
  }

  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function updateCard(card, intent) {
    const { textEl, nuanceEl, reasonEl, reasonText, quoteEl, quoteText, stateEl, stateText, toggle, check, annotateBtn, deleteBtn, status, errorSlot } = card.parts;
    // While a version is written or a recording is collected, the cards hold still.
    const inflight = Boolean(conv.inflight) || synthesizing > 0;
    const recording = card.recordingSeconds !== null;
    const state = stateOf(intent);
    card.el.classList.toggle('is-off', !intent.active);
    card.el.classList.toggle('is-busy', card.busy);
    card.el.classList.toggle('is-recording', recording);
    card.el.dataset.state = state;
    card.el.classList.toggle('is-fresh', fresh.has(intent.id));

    setText(textEl, intent.text);
    nuanceEl.hidden = !intent.nuance;
    setText(nuanceEl, intent.nuance ?? '');
    reasonEl.hidden = !intent.reason;
    setText(reasonText, intent.reason ?? '');
    const quotes = quotesOf(intent);
    quoteEl.hidden = !quotes.length;
    if (quoteText.dataset.key !== quotes.join('\u0000')) {
      quoteText.dataset.key = quotes.join('\u0000');
      clear(quoteText).append(...quotes.map((q) => h('q', q)));
    }

    const label = stateLabel(intent, state);
    setText(stateText, label);
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
    deleteBtn.disabled = locked || inflight || card.busy || recording;
    deleteBtn.title = t('intents.delete');
    deleteBtn.setAttribute('aria-label', t('intents.deleteLabel', { text: intent.text }));

    clear(status);
    if (recording) status.append(t('canvas.recordingStatus', { seconds: card.recordingSeconds }));
    else if (card.busy) status.append(busy(t('intents.updating')));
    status.hidden = !status.firstChild;
    clear(errorSlot).append(errorStrip(card.error) ?? '');
  }

  // Groups: a row of groups; under the row the cards of the open group, next to each other. One group is
  // open at a time, and selecting the open group closes it. Groups are generative (the model names them,
  // intent.group); the server keeps their order and gives each a light accent colour, which its cards
  // carry too.
  const groupOf = (intent) => String(intent.group ?? intent.topic ?? '').trim();
  const groupName = (key) => key || t('intents.groupOther');
  const accentOf = (key) => {
    if (accents[key]) return accents[key];
    let hash = 0;
    for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) % 997;
    return [6, 3, 1, 7, 8, 5, 9, 4, 2, 10][hash % 10];
  };
  // Changed cards light up for a moment, and the group of the first change opens.
  function showChanges(changes) {
    const touched = [...(changes?.added ?? []), ...(changes?.updated ?? [])];
    const first = intents.find((x) => x.id === touched[0]);
    if (first) openGroup = groupOf(first);
    fresh.clear();
    touched.forEach((id) => fresh.add(id));
    clearTimeout(freshTimer);
    if (touched.length) freshTimer = setTimeout(() => { fresh.clear(); render(); }, 2500);
  }
  const countChanges = (c) => ({ added: c?.added?.length ?? 0, updated: c?.updated?.length ?? 0, merged: c?.merged?.length ?? 0, removed: c?.removed?.length ?? 0 });
  const groups = new Map(); // group → group button
  const groupRow = h('div.ic-groups', { role: 'group', 'aria-label': t('intents.groupsLabel') });
  const cardRow = h('ol.ic-list.ic-row', { id: `ic-row-${round}` });

  function createGroup(key) {
    const name = h('span.ic-group__name');
    const count = h('span.ic-group__count');
    const mark = h('span.ic-group__mark', { 'aria-hidden': 'true' });
    const el = h('button.ic-group', { type: 'button', 'aria-controls': cardRow.id, dataset: { group: key } },
      h('span.ic-group__dot', { 'aria-hidden': 'true' }), name, count, mark);
    el.addEventListener('click', () => {
      openGroup = openGroup === key ? null : key;
      logEvent('intents.groupToggled', { group: key, open: openGroup === key, count: intents.filter((x) => groupOf(x) === key).length });
      render();
    });
    return { el, name, count, mark };
  }

  const panelStatus = h('div.ic-status', { 'aria-live': 'polite' });
  const panelBody = h('div.ic-panel__body', { tabindex: '-1' });
  const panel = h('aside.ic-panel', { dataset: { region: 'intents' }, 'aria-label': t('intents.panelLabel') }, panelBody);

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

  // The active intents differ from those the latest version was written from.
  function changedSinceVersion() {
    const used = conv.turns.at(-1)?.intents;
    if (!used) return false;
    const now = activeIntents();
    if (now.length !== used.length) return true;
    return now.some((x) => { const u = used.find((y) => y.id === x.id); return !u || (u.updatedAt ? u.updatedAt !== x.updatedAt : u.text !== x.text); });
  }

  function renderPanel() {
    // Cards for intents that exist; drop cards of intents that are gone.
    for (const [id, card] of cards) {
      if (!intents.some((x) => x.id === id)) { card.input?.destroy(); card.el.remove(); cards.delete(id); }
    }
    const byTopic = new Map(); // group → { card, intent }, newest first
    for (const intent of [...intents].reverse()) {
      if (!cards.has(intent.id)) cards.set(intent.id, createCard(intent));
      const card = cards.get(intent.id);
      updateCard(card, intent);
      const key = groupOf(intent);
      card.el.dataset.accent = String(accentOf(key));
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push({ card, intent });
    }
    const rank = (key) => (groupOrder.includes(key) ? groupOrder.indexOf(key) : groupOrder.length);
    const keys = [...byTopic.keys()].sort((a, b) => rank(a) - rank(b)); // stable: groups not in the order keep theirs
    // A group with a recording or a change running stays open; the first choice falls on a group with
    // something new, else the first group.
    const working = keys.find((k) => byTopic.get(k).some((m) => m.card.busy || m.card.recordingSeconds !== null));
    if (working !== undefined) openGroup = working;
    if (openGroup === undefined || (openGroup !== null && !byTopic.has(openGroup))) {
      openGroup = keys.find((k) => byTopic.get(k).some((m) => ['new', 'changed'].includes(stateOf(m.intent)))) ?? keys[0] ?? undefined;
    }
    for (const [key, g] of groups) if (!byTopic.has(key)) { g.el.remove(); groups.delete(key); }
    const ordered = keys.map((key) => {
      if (!groups.has(key)) groups.set(key, createGroup(key));
      const g = groups.get(key);
      const members = byTopic.get(key);
      const on = members.filter((m) => m.intent.active).length;
      const open = openGroup === key;
      g.el.dataset.accent = String(accentOf(key));
      setText(g.name, groupName(key));
      setText(g.count, t('intents.groupCount', { active: on, total: members.length }));
      g.el.setAttribute('aria-label', t('intents.groupLabel', { name: groupName(key), active: on, total: members.length }));
      g.el.setAttribute('aria-expanded', String(open));
      g.el.classList.toggle('is-open', open);
      const hasNew = members.some((m) => ['new', 'changed'].includes(stateOf(m.intent)));
      g.mark.hidden = !hasNew;
      g.el.classList.toggle('has-new', hasNew);
      return g.el;
    });
    place(groupRow, ordered);
    const shown = openGroup !== null && openGroup !== undefined ? byTopic.get(openGroup) ?? [] : [];
    place(cardRow, shown.map((m) => m.card.el));
    cardRow.hidden = !shown.length;
    cardRow.dataset.accent = String(accentOf(openGroup ?? ''));

    const status = [];
    if (transcribing) status.push(h('div.ic-pending', busy(t('canvas.transcribing'))));
    // What the participant said appears at once, while it is being brought into the intents.
    for (const text of finding) status.push(h('div.ic-pending', busy(t('intents.finding')), h('q.ic-pending__text', text)));
    if (structuring) status.push(h('div.ic-pending', busy(t('intents.structuring'))));
    if (inputError) status.push(errorStrip(inputError));
    const idle = !synthesizing && !transcribing;
    if (lastUndo && idle && !conv.inflight) {
      const undoBtn = h('button.fh-btn.fh-btn--transparent.ic-undo__btn', { type: 'button', disabled: locked || anyRecording() }, icon('undo'), h('span', t('intents.undo')));
      undoBtn.addEventListener('click', undo);
      status.push(h('div.ic-undo', h('span.ic-undo__text', undoText(lastUndo)), undoBtn));
    }
    if (noneFound && idle) status.push(messageStrip('information', t('intents.noneFound')));
    if (!intents.length && idle) status.push(h('p.vc-draft__empty', t(ptt ? 'intents.emptyPushToTalk' : 'intents.emptyToggle')));
    else if (idle && !conv.inflight && changedSinceVersion()) status.push(h('p.ic-hint', t('intents.changedSince', { n: versionOf(conv.turns.at(-1).n) })));
    clear(panelStatus).append(...status);
    panelStatus.hidden = !status.length;
    if (panelBody.firstChild !== groupRow) clear(panelBody).append(groupRow, panelStatus, cardRow);
    groupRow.hidden = !keys.length;
    return panel;
  }

  // The send button says what the next version is built from: the intents that are on.
  function sendLabel() {
    const n = activeIntents().length;
    const next = versionOf((conv.turns.at(-1)?.n ?? 0) + 1);
    if (!n) return ['intents.send'];
    return [n === 1 ? 'intents.sendFromOne' : 'intents.sendFrom', { n, version: next }];
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
    const working = transcribing || synthesizing > 0 || cardsBusy();
    // A card that is being changed by voice would race with the next synthesis: wait for it.
    const canRecord = !locked && !transcribing && !inflight && !starting && !startError && !anyRecordingOtherThanMain() && !cardsBusy();
    if (input) {
      if (input.recording) recButton.disabled = locked;
      else input.setEnabled(canRecord);
    } else recButton.disabled = true;
    const ready = hasDraft() ? activeIntents().length > 0 : Boolean(draftText());
    sendBtn.disabled = locked || starting || !ready || working || inflight || anyRecording();
    finishBtn.disabled = locked;
  }
  const anyRecordingOtherThanMain = () => [...cards.values()].some((c) => c.input?.recording);

  // ----- main recording: first instruction, then collecting intents -----
  // Recordings are collected one after the other, each from the result of the one before.
  function collect(text) {
    synthesizing++;
    finding.unshift(text);
    noneFound = false;
    lastUndo = null; // only the latest recording can be undone
    const busyKey = `collect:${Math.random().toString(36).slice(2)}`;
    conv.setBusy(busyKey, true);
    render();
    queue = queue.then(() => runCollect(text, busyKey));
  }
  async function runCollect(text, busyKey) {
    const started = performance.now();
    try {
      if (destroyed) return;
      const res = await api.intents.collect(round, text, aiTimeout());
      if (destroyed) return;
      intents = res.intents;
      takeGroups(res);
      const c = res.changes ?? {};
      noneFound = !c.added?.length && !c.updated?.length && !c.removed?.length && !c.merged?.length;
      lastUndo = res.undoToken ? { token: res.undoToken, kind: 'recording', changes: c } : null;
      showChanges(c);
      remember();
      // The transcript and the intents before and after are logged by the server (server.intents.collected).
      logEvent('intents.collected', { ...countChanges(c), active: activeIntents().length, latencyMs: Math.round(performance.now() - started), mock: res.mock });
    } catch (e) {
      if (destroyed) return;
      logEvent('intents.collectFailed', { error: e.code ?? e.name });
      inputError = { key: errorKey(e) ?? 'intentsCollect', retry: () => { inputError = null; collect(text); } };
    } finally {
      synthesizing--;
      finding.splice(finding.indexOf(text), 1);
      conv.setBusy(busyKey, false);
      if (!destroyed) render();
    }
  }

  // What the last recording (or change by voice) did, next to its Undo button.
  function undoText({ kind, changes: c }) {
    if (kind === 'annotation') return t('intents.undoAnnotation');
    const parts = [];
    if (c.added?.length) parts.push(t(c.added.length === 1 ? 'intents.undoAddedOne' : 'intents.undoAdded', { n: c.added.length }));
    const changed = (c.updated?.length ?? 0) + (c.removed?.length ?? 0);
    if (changed) parts.push(t(changed === 1 ? 'intents.undoChangedOne' : 'intents.undoChanged', { n: changed }));
    return t('intents.undoRecording', { what: parts.join(t('intents.undoAnd')) });
  }
  async function undo() {
    const u = lastUndo;
    if (!u || locked) return;
    lastUndo = null;
    inputError = null;
    render();
    try {
      const res = await api.intents.undo(round, u.token);
      if (destroyed) return;
      intents = res.intents;
      takeGroups(res);
      noneFound = false;
      showChanges({ updated: res.restored ?? [] });
      remember();
      logEvent('intents.undone', { kind: u.kind, ...countChanges(u.changes), restored: res.restored?.length ?? 0 });
    } catch (e) {
      if (destroyed) return;
      // Expired (a newer change came first) or failed: the cards stay as they are.
      logEvent('intents.undoFailed', { kind: u.kind, error: e.code ?? e.name });
      if (e.code !== 'undo_expired') { lastUndo = u; inputError = { key: 'intentsUndo' }; }
    } finally {
      if (!destroyed) render();
    }
  }

  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: recButton,
      // 'instruction': builds the first instruction; 'intents': collected as intents.
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
        if (hasDraft()) { collect(text); return; } // marks itself busy at once
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
    // A new version starts a new round: the plan is made from all cards, and the last recording can no
    // longer be undone.
    lastUndo = null;
    structuring = true;
    await conv.send(active.map((x) => `- ${x.text}${x.reason ? ` (why: ${x.reason})` : ''}`).join('\n'),
      { step: 'intents', intents: active.length, intentIds: active.map((x) => x.id), inactive: intents.length - active.length, unchanged: active.filter((x) => stateOf(x) === 'applied').length },
      { intentIds: active.map((x) => x.id) });
    structuring = false;
    if (!destroyed) render();
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
      if (name === 'intentCard') return cardRow.querySelector('.ic-card');
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
      clearTimeout(freshTimer);
      input?.destroy();
      for (const c of cards.values()) c.input?.destroy();
      response.destroy();
      sidebar.destroy();
      conv.destroy();
    },
  });
}
