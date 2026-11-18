// Highlight mode canvas. The draft fills the middle; there is no main record or send button.
//
//   Start: the task's generic starting draft (task.scaffold, stored as turn 1 via /api/intents/start).
//   Select text in the draft: the selection is snapped to whole words and framed (a pill for one line, a
//   rounded box that follows the text for several). Next to it a small toolbar: microphone (annotate by
//   voice; recordings are added to the annotation), send to the assistant, remove. Send asks the AI for
//   targeted edits (/api/highlight/edit): only the affected parts of the draft change, and they flash.
//   Challenge Me (where the send button is in the other modes) takes the draft, the highlighted passage
//   and the annotation and shows a short question in a popup. It is not answered and changes nothing.
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
import { agentAvatar, busy } from '../../core/canvas/latestResponse.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';
import { offsetOf, rangeOf, snapToWords, linesOf, blocksOf, framePath, changedRanges } from './geometry.js';

const SVG = 'http://www.w3.org/2000/svg';
const errorKey = (e, fallback) => (e?.code === 'rate_limited' ? 'canvas.errors.rateLimited'
  : e?.code === 'llm_timeout' || e?.name === 'TimeoutError' ? 'canvas.errors.timeout'
  : e?.code === 'draft_changed' ? 'highlight.errors.changed'
  : `highlight.errors.${fallback}`);

export function createCanvas(ctx, { round, task, live = true, conceal = false, showFinish = true, onTurn = null }) {
  const { config } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';
  const aiTimeout = () => AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000);

  // ----- state -----
  let sel = null; // { start, end, text } in the current draft
  let note = ''; // the annotation of the selection (transcribed recordings, joined)
  let recordingSeconds = null;
  let transcribing = false;
  let editing = false;
  let challenging = false;
  let popError = null; // { key, retry }
  let popInfo = null; // text key
  let challenge = null; // { question } shown in the popup
  let challengeError = null; // { key, retry }
  let flash = []; // changed ranges of the latest edit
  let starting = false;
  let startError = false;
  let locked = !live;
  let destroyed = false;

  const conv = createConversation(ctx, { round, live, onUpdate: () => render() });
  const draft = () => conv.turns.at(-1)?.response ?? '';
  const working = () => recordingSeconds !== null || transcribing || editing;

  // ----- layout -----
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const metaLabel = h('span');
  const meta = h('div.vc-turn__meta.hl-meta', agentAvatar(), h('span.vc-turn__name', config.ai.assistantName), metaLabel);
  const frame = document.createElementNS(SVG, 'path');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'hl-frame');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(frame);
  const body = h('div.hl-body');
  const status = h('div.hl-status', { 'aria-live': 'polite' });
  const page = h('div.hl-page', svg, body);
  const doc = h('article.hl-doc', { 'aria-label': t('highlight.docLabel') }, meta, page, status);
  const scroller = h('div.vc-convo__scroll.hl-scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, doc);
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot, scroller);

  // Toolbar of the selection: annotation, then microphone, send and remove.
  const micBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.hl-pop__mic', { type: 'button' }, icon('microphone'));
  const sendBtn = h('button.fh-btn.fh-btn--emphasized.fh-btn--icon.hl-pop__send', { type: 'button' }, icon('paper-plane'));
  const closeBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', title: t('highlight.close'), 'aria-label': t('highlight.close') }, icon('decline'));
  const noteText = h('p.hl-pop__note');
  const noteClear = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.hl-pop__clear', { type: 'button', title: t('highlight.clearNote'), 'aria-label': t('highlight.clearNote') }, icon('sys-cancel'));
  const noteRow = h('div.hl-pop__noteRow', noteText, noteClear);
  const popStatus = h('div.hl-pop__status', { 'aria-live': 'polite' });
  const pop = h('div.hl-pop', { role: 'toolbar', hidden: true }, noteRow, popStatus, h('div.hl-pop__actions', micBtn, sendBtn, closeBtn));
  page.append(pop);

  // Controls: Challenge Me in the middle (where the other modes have Send), Finish on the right, timer below.
  const challengeText = h('span', t('highlight.challenge'));
  const challengeBtn = h('button.fh-btn.fh-btn--emphasized.vc-send.hl-challenge', { type: 'button', dataset: { region: 'challenge' } }, icon('lightbulb'), challengeText);
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const askText = h('p.hl-ask__text');
  const askBody = h('div.hl-ask__body');
  const askClose = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', title: t('highlight.challengeClose'), 'aria-label': t('highlight.challengeClose') }, icon('decline'));
  const ask = h('div.hl-ask', { role: 'dialog', 'aria-modal': 'false', 'aria-label': t('highlight.challengeTitle'), hidden: true },
    h('div.hl-ask__head', icon('lightbulb', 'hl-ask__icon'), h('span.hl-ask__title', t('highlight.challengeTitle')), askClose),
    askBody);
  const controls = h('footer.vc-controls.hl-controls',
    ask,
    h('div.vc-controls__row',
      h('div.vc-controls__side'),
      h('div.vc-controls__main', challengeBtn),
      h('div.vc-controls__side.vc-controls__side--end', finishBtn)),
    timerSlot);
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  // ----- the draft -----
  let shownText = null;
  let shownFlash = null;
  function renderBody() {
    const text = draft();
    if (text === shownText && flash === shownFlash) return;
    shownText = text;
    shownFlash = flash;
    clear(body);
    let pos = 0;
    for (const r of flash) {
      if (r.start > pos) body.append(text.slice(pos, r.start));
      body.append(h('span.hl-changed', text.slice(r.start, r.end)));
      pos = r.end;
    }
    body.append(text.slice(pos));
  }

  // Frame and toolbar follow the selection (and the layout: resizing re-wraps the text).
  function layout() {
    if (!sel || !body.firstChild) { frame.setAttribute('d', ''); pop.hidden = true; return; }
    const range = rangeOf(body, sel.start, sel.end);
    if (!range) return;
    const box = page.getBoundingClientRect();
    const lines = linesOf(range, box);
    if (!lines.length) return;
    frame.setAttribute('d', framePath(blocksOf(lines)));
    pop.hidden = false;
    const last = lines.at(-1);
    const width = pop.offsetWidth;
    const left = Math.max(0, Math.min(last.r - width + 8, page.clientWidth - width));
    pop.style.left = `${left}px`;
    pop.style.top = `${last.b + 8}px`;
  }
  const resize = new ResizeObserver(() => layout());
  resize.observe(page);

  function setSelection(next, via) {
    const had = sel;
    if (had && note) logEvent('annotation.discarded', { start: had.start, end: had.end, chars: note.length, via });
    sel = next;
    note = '';
    popError = null;
    popInfo = null;
    if (next) logEvent('selection.made', { start: next.start, end: next.end, chars: next.end - next.start, text: next.text, replaced: Boolean(had) });
    else if (had) logEvent('selection.cleared', { via });
    render();
  }

  // A finished mouse or touch selection inside the draft becomes the highlighted passage.
  function onPointerUp(e) {
    if (locked || working() || challenging || pop.contains(e.target)) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!body.contains(r.startContainer) || !body.contains(r.endContainer)) return;
    const text = draft();
    const snapped = snapToWords(text, offsetOf(body, r.startContainer, r.startOffset), offsetOf(body, r.endContainer, r.endOffset));
    s.removeAllRanges();
    if (!snapped) return;
    if (sel && snapped.start === sel.start && snapped.end === sel.end) return;
    setSelection({ ...snapped, text: text.slice(snapped.start, snapped.end) }, 'select');
  }
  document.addEventListener('pointerup', onPointerUp);
  const onKey = (e) => { if (e.key === 'Escape' && sel && !working() && !document.querySelector('.app-modal')) setSelection(null, 'escape'); };
  document.addEventListener('keydown', onKey);

  closeBtn.addEventListener('click', () => setSelection(null, 'close'));
  noteClear.addEventListener('click', () => {
    logEvent('annotation.cleared', { chars: note.length });
    note = '';
    popError = null;
    render();
  });

  // ----- annotation by voice -----
  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: micBtn,
      keyboard: 'focus',
      log: () => ({ target: 'annotation', start: sel?.start, end: sel?.end }),
      busy: (key, on) => conv.setBusy(`note:${key}`, on),
      onStart() { popError = null; popInfo = null; recordingSeconds = 0; render(); },
      onTick(s) { recordingSeconds = Math.floor(s); renderPop(); },
      onStop() { recordingSeconds = null; render(); },
      onTranscribing(on) { transcribing = on; render(); },
      onText(text) {
        if (!sel) return;
        note = note ? `${note} ${text}` : text;
        logEvent('annotation.added', { start: sel.start, end: sel.end, chars: text.length, totalChars: note.length });
        render();
      },
      onFail(key, retry) { recordingSeconds = null; popError = { key: `canvas.errors.${key}`, retry }; render(); },
    });
  }

  // ----- send to the AI: targeted edit -----
  async function edit() {
    if (!sel || !note || locked || working()) return;
    const target = sel;
    const annotation = note;
    editing = true;
    popError = null;
    popInfo = null;
    conv.setBusy('edit', true);
    render();
    const before = draft();
    const started = performance.now();
    logEvent('edit.sent', { start: target.start, end: target.end, chars: annotation.length });
    try {
      const res = await api.highlight.edit(round, { start: target.start, end: target.end, selected: target.text }, annotation, aiTimeout());
      if (destroyed) return;
      const latencyMs = Math.round(performance.now() - started);
      if (!res.turn) {
        logEvent('edit.unchanged', { latencyMs, mock: res.mock });
        popInfo = 'highlight.unchanged';
        return;
      }
      flash = changedRanges(before, res.turn.response);
      logEvent('edit.received', { turn: res.turn.n, latencyMs, edits: res.turn.edits.length, changedRanges: flash.length, mock: res.mock });
      sel = null;
      note = '';
      conv.adopt(res.turn); // re-renders
      onTurn?.(res.turn, { resumed: false });
      body.querySelector('.hl-changed')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      if (destroyed) return;
      logEvent('edit.failed', { error: e.code ?? e.name });
      popError = { key: errorKey(e, 'edit'), retry: e.code === 'draft_changed' ? null : edit };
    } finally {
      editing = false;
      conv.setBusy('edit', false);
      if (!destroyed) render();
    }
  }
  sendBtn.addEventListener('click', edit);

  // ----- challenge -----
  function showChallenge() {
    ask.hidden = !(challenge || challengeError || challenging);
    if (challenging) clear(askBody).append(busy(t('highlight.challenging')));
    else if (challengeError) {
      clear(askBody).append(messageStrip('error', t(challengeError.key)),
        challengeError.retry ? h('div', h('button.fh-btn', { type: 'button', onclick: challengeError.retry }, t('common.retry'))) : '');
    } else if (challenge) {
      askText.textContent = challenge.question;
      clear(askBody).append(askText, h('p.hl-ask__note', t('highlight.challengeNote')));
    }
  }

  async function requestChallenge() {
    if (!sel || locked || working() || challenging) return;
    const target = sel;
    challenging = true;
    challenge = null;
    challengeError = null;
    conv.setBusy('challenge', true);
    render();
    const started = performance.now();
    logEvent('challenge.requested', { start: target.start, end: target.end, annotated: Boolean(note), noteChars: note.length });
    try {
      const res = await api.highlight.challenge(round, { start: target.start, end: target.end, selected: target.text }, note, aiTimeout());
      if (destroyed) return;
      challenge = { question: res.question };
      // The question itself is logged by the server (server.highlight.challenge).
      logEvent('challenge.shown', { latencyMs: Math.round(performance.now() - started), chars: res.question.length, mock: res.mock });
    } catch (e) {
      if (destroyed) return;
      logEvent('challenge.failed', { error: e.code ?? e.name });
      challengeError = { key: errorKey(e, 'challenge'), retry: e.code === 'draft_changed' ? null : requestChallenge };
    } finally {
      challenging = false;
      conv.setBusy('challenge', false);
      if (!destroyed) render();
    }
  }
  challengeBtn.addEventListener('click', requestChallenge);
  askClose.addEventListener('click', () => {
    if (challenge) logEvent('challenge.closed', {});
    challenge = null;
    challengeError = null;
    render();
  });

  // ----- render -----
  function renderPop() {
    const recording = recordingSeconds !== null;
    pop.classList.toggle('is-recording', recording);
    noteText.textContent = note || t(ptt ? 'highlight.notePlaceholderPushToTalk' : 'highlight.notePlaceholderToggle');
    noteText.classList.toggle('is-empty', !note);
    noteClear.hidden = !note || working();
    clear(popStatus);
    if (recording) popStatus.append(t('canvas.recordingStatus', { seconds: recordingSeconds }));
    else if (transcribing) popStatus.append(busy(t('canvas.transcribing')));
    else if (editing) popStatus.append(busy(t('highlight.editing')));
    if (popError) {
      popStatus.append(messageStrip('error', t(popError.key)));
      if (popError.retry) popStatus.append(h('button.fh-btn', { type: 'button', onclick: () => { const r = popError.retry; popError = null; r(); } }, t('common.retry')));
    } else if (popInfo) popStatus.append(messageStrip('information', t(popInfo)));
    popStatus.hidden = !popStatus.firstChild;

    const micAction = recording && !ptt ? t('highlight.annotateStop') : t(ptt ? 'highlight.annotateHold' : 'highlight.annotateStart');
    micBtn.title = micAction;
    micBtn.setAttribute('aria-label', micAction);
    if (input) {
      if (recording) micBtn.disabled = locked;
      else input.setEnabled(!locked && !transcribing && !editing && !challenging);
    } else micBtn.disabled = true;
    sendBtn.disabled = locked || !note || working() || challenging;
    const sendLabel = note ? t('highlight.send') : t('highlight.sendNeedsNote');
    sendBtn.title = sendLabel;
    sendBtn.setAttribute('aria-label', sendLabel);
    closeBtn.disabled = locked || working();
  }

  function render() {
    if (destroyed) return;
    const latest = conv.turns.at(-1);
    metaLabel.textContent = !latest ? '' : latest.kind === 'scaffold' ? t('canvas.scaffoldLabel') : t('canvas.versionLabel', { n: conv.turns[0]?.kind === 'scaffold' ? latest.n - 1 : latest.n });
    renderBody();
    doc.classList.toggle('is-locked', locked || working() || challenging);
    svg.classList.toggle('is-working', editing);
    clear(status);
    if (starting) status.append(busy(t('canvas.scaffoldLoading')));
    else if (startError) status.append(messageStrip('error', t('canvas.errors.scaffold')), h('div', h('button.fh-btn', { type: 'button', onclick: start }, t('common.retry'))));
    else if (!latest) status.append(h('p.vc-draft__empty', t('highlight.noDraft')));
    else if (!sel) status.append(h('p.hl-hint', icon('text-formatting'), t('highlight.hint')));
    renderPop();
    layout();

    challengeBtn.disabled = locked || !sel || working() || challenging;
    challengeBtn.title = sel ? '' : t('highlight.challengeHint');
    challengeText.textContent = t('highlight.challenge');
    finishBtn.disabled = locked;
    showChallenge();
  }

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
  const el = h('div.vc.hl', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls);
  render();
  if (live && task?.scaffold && !conv.turns.length) start();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, output: scroller, challenge: challengeBtn, timer: timerSlot, finish: finishBtn },
    getRegion(name) { return this.regions[name]; },
    isBusy: () => conv.isBusy(),
    whenIdle: () => conv.whenIdle(),
    setLocked(on) {
      locked = on;
      render();
    },
    stopRecording(reason) { input?.stop(reason); },
    destroy() {
      destroyed = true;
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keydown', onKey);
      resize.disconnect();
      input?.destroy();
      conv.destroy();
    },
  });
}
