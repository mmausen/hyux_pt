// Voice mode canvas: task panel (top, fixed), the assistant's latest response (middle; earlier responses
// are not shown, only the newest version, with how long ago it was updated) next to the current
// instruction, and the controls (bottom: record, send, finish, timer slot). Input is voice only: the
// draft is built from transcribed recordings and cannot be edited by typing.
//
// createCanvas(ctx, { round, task, live, conceal, sample, showFinish, onTurn }) → {
//   el, timerSlot, noticeSlot, regions (task, record, transcript, send, output, timer, finish), onFinishRequest,
//   isBusy(), setLocked(bool), stopRecording(reason), whenIdle(), destroy()
// }
// live=false renders the same layout without input (briefing backdrop, tutorial). conceal hides the task text.
//
// The conversation itself (sending, streaming, resuming after a reload, busy/idle) is core/conversation.js;
// the task panel, response view, controls and recording are shared parts in core/canvas/. This file
// adds what is specific to the mode: the draft built from recordings, and the layout.
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
import { createLatestResponse, busy } from '../../core/canvas/latestResponse.js';
import { createControls } from '../../core/canvas/controls.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

export function createCanvas(ctx, { round, task, live = true, conceal = false, sample = null, showFinish = true, onTurn = null }) {
  const { config, session } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  // ----- state -----
  // The draft is the instruction being built from one or more transcribed recordings.
  let draft = sample ? (sample.draft ? [{ text: sample.draft }] : []) : [...(session.progress(round).draft ?? [])];
  let transcribing = false;
  let transcriptError = null; // { key, retry }
  let locked = !live;
  let destroyed = false;

  const draftText = () => draft.map((d) => d.text).join(' ').trim();
  const saveDraft = () => live && session.updateProgress(round, { draft }, { immediate: true });

  const conv = createConversation(ctx, {
    round,
    live,
    sample: sample?.turns ?? null,
    onUpdate: () => render(),
    onDelta: (text) => { if (!response.delta(text)) render(); },
    onTurn(turn, info) {
      response.markUpdated();
      // The draft that produced this turn is done (also when the turn finished during a reload).
      if (draftText() === turn.transcript) { draft = []; saveDraft(); }
      onTurn?.(turn, info);
    },
  });

  // ----- layout -----
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const view = h('div.vc-turn');
  const scroller = h('div.vc-convo__scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, view);
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot, scroller);
  const response = createLatestResponse({ assistant: config.ai.assistantName, scroller, latest: conv.turns.at(-1) });
  const controls = createControls(ctx, { showFinish });
  const { recButton, sendBtn, finishBtn, timerSlot } = controls;
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  function instructionBlock(turn) {
    return h('aside.vc-instruction',
      h('div.vc-instruction__label', t('canvas.instructionLabel')),
      h('p.vc-instruction__text', turn.transcript),
      turn.sentAt ? h('div.vc-instruction__time', t('canvas.sentAt', { time: timeOf(turn.sentAt) })) : null);
  }

  const clearBtn = h('button.fh-btn.fh-btn--transparent', { type: 'button', 'aria-label': t('canvas.clearLabel') }, icon('decline'), h('span', t('canvas.clear')));
  clearBtn.addEventListener('click', () => {
    const text = draftText();
    draft = [];
    transcriptError = null;
    saveDraft();
    logEvent('draft.cleared', { text });
    render();
  });

  function draftBlock() {
    const text = draftText();
    const box = h('aside.vc-instruction.vc-draft', { dataset: { region: 'transcript' }, 'aria-live': 'polite' },
      h('div.vc-draft__head', h('div.vc-instruction__label', t('canvas.draftLabel')), clearBtn));
    clearBtn.disabled = locked || !text || transcribing;
    box.append(text ? h('p.vc-instruction__text', text) : h('p.vc-draft__empty', t(ptt ? 'canvas.draftEmptyPushToTalk' : 'canvas.draftEmptyToggle')));
    if (transcribing) box.append(busy(t('canvas.transcribing')));
    if (transcriptError) {
      box.append(messageStrip('error', t(`canvas.errors.${transcriptError.key}`)));
      if (transcriptError.retry) box.append(h('div', h('button.fh-btn', { type: 'button', onclick: transcriptError.retry }, t('common.retry'))));
    }
    return box;
  }

  // Left: the response being written, else the latest one. Right: the instruction being answered while
  // the assistant writes, else the instruction being recorded for the next version.
  function render() {
    if (destroyed) return;
    const { inflight } = conv;
    clear(view).append(
      response.render({ inflight, latest: conv.turns.at(-1), error: conv.error }),
      inflight ? instructionBlock(inflight) : draftBlock());
    renderControls();
  }

  function renderControls() {
    const inflight = conv.inflight;
    const canRecord = !locked && !transcribing && !inflight;
    if (input) {
      if (input.recording) recButton.disabled = locked;
      else input.setEnabled(canRecord);
    } else recButton.disabled = true;
    sendBtn.disabled = locked || !draftText() || transcribing || Boolean(inflight) || Boolean(input?.recording);
    finishBtn.disabled = locked;
  }

  // ----- recording + transcription -----
  // Declared before the first render (renderControls reads it).
  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: recButton,
      busy: (key, on) => conv.setBusy(key, on),
      onStart() {
        transcriptError = null;
        conv.clearError();
        controls.recordingStarted();
        renderControls();
      },
      onTick: controls.recordingTick,
      onLevel: controls.recordingLevel,
      onStop: controls.recordingStopped,
      onTranscribing(on) {
        transcribing = on;
        if (on) { transcriptError = null; conv.clearError(); }
        render();
      },
      onText(text, rec) {
        draft.push({ text, at: new Date().toISOString(), recordingMs: rec.durationMs });
        saveDraft();
      },
      onFail(key, retry) {
        if (key === 'mic') controls.recordingStopped();
        transcriptError = { key, retry };
        render();
      },
    });
  }

  // ----- send to AI -----
  async function send() {
    const text = draftText();
    if (!text || locked || conv.inflight || transcribing) return;
    await conv.send(text, { segments: draft.length });
  }
  sendBtn.addEventListener('click', send);

  // ----- assemble -----
  const el = h('div.vc', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls.el);
  render();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, record: recButton.parentElement, transcript: null, send: sendBtn, output: convo, timer: timerSlot, finish: finishBtn },
    getRegion(name) { return name === 'transcript' ? el.querySelector('[data-region="transcript"]') : this.regions[name]; },
    isBusy: () => conv.isBusy(),
    whenIdle: () => conv.whenIdle(),
    setLocked(on) {
      locked = on;
      renderControls();
      if (!conv.inflight) render();
    },
    stopRecording(reason) { input?.stop(reason); },
    destroy() {
      destroyed = true;
      input?.destroy();
      response.destroy();
      conv.destroy();
    },
  });
}
