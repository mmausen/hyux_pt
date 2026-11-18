// Intents mode canvas. The participant still thinks aloud, but after the first draft their words become
// intent cards that they can switch on and off and change by voice.
//
//   Step 1 (no draft yet): like the voice mode. Recordings build an instruction, which is sent as spoken
//   and produces the first draft.
//   From then on: each recording is transcribed and split by the LLM into one or more intents, shown as
//   cards next to the draft (newest first). A card has a short description, a switch (on/off) and a
//   hold-to-change button; an annotation is transcribed and the LLM rewrites the intent on release.
//   Send hands the AI only the active intents plus the latest draft (no history), which gives the next
//   version. Cards stay; new recordings add new cards.
//
// Same interface as the voice canvas (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }). Extra regions for the
// tour: intents (the card panel), intentCard (the first card).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
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
  let noneFound = false; // the last recording held no intent
  let locked = !live;
  let destroyed = false;
  const serverIntents = () => session.data?.rounds?.[String(round)]?.intents ?? [];
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
    sample: sample?.turns ?? null,
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
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const left = h('div');
  const scroller = h('div.vc-convo__scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, left);
  const side = h('div.ic-side');
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot, h('div.ic-layout', scroller, side));
  const response = createLatestResponse({ assistant: config.ai.assistantName, scroller, latest: conv.turns.at(-1) });
  const controls = createControls(ctx, { showFinish });
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
  // A card keeps its DOM (and its recorder) across renders; render() only reorders and updates them.
  function lastSentAt(intent) {
    const n = intent.sentIn?.at(-1);
    return n ? conv.turns.find((x) => x.n === n)?.sentAt ?? null : null;
  }

  function createCard(intent) {
    const id = intent.id;
    const textEl = h('p.ic-card__text');
    const tags = h('div.ic-card__tags');
    const toggle = h('input', { type: 'checkbox', role: 'switch' });
    const switchLabel = h('label.fh-switch.ic-card__switch', toggle, h('span.fh-switch__track'), h('span.ic-card__switch-text'));
    const annotateLabel = h('span', t(ptt ? 'intents.annotateHold' : 'intents.annotateStart'));
    const annotateBtn = h('button.fh-btn.fh-btn--transparent.ic-card__annotate', { type: 'button' }, icon('microphone'), annotateLabel);
    const status = h('div.ic-card__status', { 'aria-live': 'polite' });
    const errorSlot = h('div');
    const el = h('li.ic-card', { dataset: { intent: id } },
      h('div.ic-card__head', tags, switchLabel),
      textEl,
      h('div.ic-card__foot', annotateBtn, status),
      errorSlot);

    // transcribing: the annotation is being converted to text; annotating: the LLM rewrites the intent.
    const card = { el, transcribing: false, annotating: false, get busy() { return this.transcribing || this.annotating; }, input: null, error: null, recordingSeconds: null };

    toggle.addEventListener('change', async () => {
      const intentNow = intents.find((x) => x.id === id);
      const active = toggle.checked;
      intentNow.active = active;
      card.error = null;
      remember();
      logEvent('intent.toggled', { id, active, activeCount: activeIntents().length });
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

    card.parts = { textEl, tags, toggle, switchLabel, annotateBtn, annotateLabel, status, errorSlot };
    return card;
  }

  function updateCard(card, intent) {
    const { textEl, tags, toggle, switchLabel, annotateBtn, annotateLabel, status, errorSlot } = card.parts;
    const inflight = Boolean(conv.inflight);
    const recording = card.recordingSeconds !== null;
    card.el.classList.toggle('is-off', !intent.active);
    card.el.classList.toggle('is-busy', card.busy);
    card.el.classList.toggle('is-recording', recording);
    if (textEl.textContent !== intent.text) textEl.textContent = intent.text;

    const sentAt = lastSentAt(intent);
    const changed = sentAt && (intent.annotations ?? []).some((a) => a.at > sentAt);
    clear(tags);
    if (!intent.sentIn?.length) tags.append(h('span.fh-tag.fh-tag--information', t('intents.tagNew')));
    else if (changed) tags.append(h('span.fh-tag.fh-tag--warning', t('intents.tagChanged')));
    else tags.append(h('span.fh-tag', t('intents.tagSent', { n: intent.sentIn.at(-1) })));

    toggle.checked = Boolean(intent.active);
    toggle.disabled = locked || inflight;
    toggle.setAttribute('aria-label', t('intents.useLabel', { text: intent.text }));
    switchLabel.lastChild.textContent = t(intent.active ? 'intents.on' : 'intents.off');

    const canAnnotate = !locked && !inflight && !card.busy && (recording || !anyRecording());
    if (card.input) {
      if (recording) annotateBtn.disabled = locked;
      else card.input.setEnabled(canAnnotate);
    } else annotateBtn.disabled = true;
    annotateBtn.setAttribute('aria-label', `${t(ptt ? 'intents.annotateHold' : 'intents.annotateStart')}: ${intent.text}`);
    annotateLabel.textContent = recording && !ptt ? t('intents.annotateStop') : t(ptt ? 'intents.annotateHold' : 'intents.annotateStart');

    clear(status);
    if (recording) status.append(t('canvas.recordingStatus', { seconds: card.recordingSeconds }));
    else if (card.busy) status.append(busy(t('intents.updating')));
    clear(errorSlot).append(errorStrip(card.error) ?? '');
  }

  const listEl = h('ol.ic-list');
  const panelCount = h('span.ic-panel__count');
  const panelBody = h('div.ic-panel__body', { tabindex: '-1' });
  const panel = h('aside.ic-panel', { dataset: { region: 'intents' }, 'aria-label': t('intents.panelLabel') },
    h('div.ic-panel__head', h('div.vc-instruction__label', t('intents.panelLabel')), panelCount),
    panelBody);

  function renderPanel() {
    const active = activeIntents().length;
    panelCount.textContent = intents.length ? t('intents.count', { active, total: intents.length }) : '';
    // Cards for intents that exist; drop cards of intents that are gone.
    for (const [id, card] of cards) {
      if (!intents.some((x) => x.id === id)) { card.input?.destroy(); card.el.remove(); cards.delete(id); }
    }
    const ordered = [...intents].reverse(); // newest first
    for (const intent of ordered) {
      if (!cards.has(intent.id)) cards.set(intent.id, createCard(intent));
    }
    ordered.forEach((intent, i) => {
      const card = cards.get(intent.id);
      updateCard(card, intent);
      if (listEl.children[i] !== card.el) listEl.insertBefore(card.el, listEl.children[i] ?? null);
    });

    const top = [];
    if (transcribing) top.push(h('div.ic-pending', busy(t('canvas.transcribing'))));
    for (let i = 0; i < extracting; i++) top.push(h('div.ic-pending', busy(t('intents.finding'))));
    if (inputError) top.push(errorStrip(inputError));
    if (noneFound && !extracting && !transcribing) top.push(messageStrip('information', t('intents.noneFound')));
    if (!intents.length && !extracting && !transcribing) top.push(h('p.vc-draft__empty', t(ptt ? 'intents.emptyPushToTalk' : 'intents.emptyToggle')));
    clear(panelBody).append(...top, listEl);
    return panel;
  }

  // ----- render -----
  function render() {
    if (destroyed) return;
    const { inflight } = conv;
    const latest = conv.turns.at(-1);
    clear(left).append(response.render({ inflight, latest, error: conv.error }));
    // Right side: before the first draft the instruction (being recorded or being answered); after it,
    // the intent cards.
    const right = !hasDraft() && !(inflight && intents.length)
      ? (inflight ? instructionBlock(inflight) : draftBlock())
      : renderPanel();
    if (side.firstChild !== right) clear(side).append(right);
    controls.setSendLabel(hasDraft() ? 'intents.send' : 'canvas.send');
    renderControls();
  }

  function renderControls() {
    const inflight = Boolean(conv.inflight);
    const working = transcribing || extracting > 0 || cardsBusy();
    const canRecord = !locked && !transcribing && !inflight && !anyRecordingOtherThanMain();
    if (input) {
      if (input.recording) recButton.disabled = locked;
      else input.setEnabled(canRecord);
    } else recButton.disabled = true;
    const ready = hasDraft() ? activeIntents().length > 0 : Boolean(draftText());
    sendBtn.disabled = locked || !ready || working || inflight || anyRecording();
    finishBtn.disabled = locked;
  }
  const anyRecordingOtherThanMain = () => [...cards.values()].some((c) => c.input?.recording);

  // ----- main recording: first instruction, then new intents -----
  async function extract(text) {
    extracting++;
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
    await conv.send(active.map((x) => `- ${x.text}`).join('\n'),
      { step: 'intents', intents: active.length, intentIds: active.map((x) => x.id), inactive: intents.length - active.length },
      { intentIds: active.map((x) => x.id) });
  }
  sendBtn.addEventListener('click', send);

  // ----- assemble -----
  const el = h('div.vc.ic', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls.el);
  render();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, record: recButton.parentElement, send: sendBtn, output: scroller, intents: panel, timer: timerSlot, finish: finishBtn },
    getRegion(name) {
      if (name === 'transcript') return el.querySelector('[data-region="transcript"]');
      if (name === 'intentCard') return listEl.firstElementChild;
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
      conv.destroy();
    },
  });
}
