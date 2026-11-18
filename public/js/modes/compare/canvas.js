// Compare mode canvas: task (top), two versions side by side (middle), timer (bottom).
//
//   Start: the server writes the first pair (/api/compare/start); both are similar but differ in a few
//   choices. Each round: the participant picks the version they prefer (Pick This One), then holds the
//   microphone in that card and says what they like most about it. Keep It and Show a New One sends pick
//   and annotation (/api/compare/next): a hidden preference profile is updated on the server, the other
//   version leaves and a new one, written from the profile and the pick, takes its place. The kept version
//   stays on its side. Accept as Final marks the picked version as the result and asks to finish the task.
//   Words that differ between the two versions can be highlighted (Show Differences).
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
import { busy } from '../../core/canvas/latestResponse.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';
import { changedRanges } from './diff.js';

const SIDES = ['left', 'right'];
const errorKey = (e) => (e?.code === 'rate_limited' ? 'rateLimited' : e?.code === 'llm_timeout' || e?.name === 'TimeoutError' ? 'timeout' : null);

export function createCanvas(ctx, { round, task, live = true, conceal = false, showFinish = true }) {
  const { config } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  // ----- state -----
  let state = null; // the server's public state: { step, pair: { left, right }, kept, picks, accepted, generating }
  let picked = null; // version id
  let note = ''; // what the participant likes most (transcribed recordings, joined)
  let recordingSeconds = null;
  let transcribing = false;
  let loading = false; // first pair
  let nexting = null; // { keptId, leavingSide } while the new version is written
  let error = null; // { key, retry }
  let noteError = null; // { key, retry }
  let showDiff = false;
  let locked = !live;
  let destroyed = false;
  let pollTimer = null;

  // Work the task end must wait for.
  const work = new Set();
  const waiters = [];
  const setBusy = (key, on) => {
    if (on) work.add(key); else work.delete(key);
    if (!work.size) waiters.splice(0).forEach((fn) => fn());
  };
  const voiceBusy = () => recordingSeconds !== null || transcribing;
  const versionAt = (side) => state?.pair?.[side] ?? null;
  const sideOf = (id) => SIDES.find((s) => versionAt(s)?.id === id) ?? null;

  // ----- layout -----
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const stepText = h('p.cp-step__text');
  const diffBtn = h('button.fh-btn.fh-btn--transparent.cp-diff', { type: 'button', 'aria-pressed': 'false' }, icon('compare'), h('span', t('compare.showDiff')));
  diffBtn.addEventListener('click', () => {
    showDiff = !showDiff;
    logEvent('compare.diffToggled', { on: showDiff });
    render();
  });
  const pairEl = h('div.cp-pair');
  const convo = h('section.vc-convo.cp-convo', { dataset: { region: 'output' } }, noticeSlot, h('div.cp-step', stepText, diffBtn), pairEl);

  // The microphone lives in the picked card.
  const micBtn = h('button.app-record.cp-mic', { type: 'button' }, icon('microphone'));
  const nextText = h('span', t('compare.next'));
  const nextBtn = h('button.fh-btn.fh-btn--emphasized.vc-send.cp-next', { type: 'button', dataset: { region: 'send' } }, icon('synchronize'), nextText);
  const acceptBtn = h('button.fh-btn.cp-accept', { type: 'button', dataset: { region: 'accept' } }, icon('accept'), h('span', t('compare.accept')));
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const controls = h('footer.vc-controls',
    h('div.vc-controls__row',
      h('div.vc-controls__side'),
      h('div.vc-controls__main', acceptBtn, nextBtn),
      h('div.vc-controls__side.vc-controls__side--end', finishBtn)),
    timerSlot);
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  // Two cards, one per side; they keep their DOM, render() fills them.
  const cards = Object.fromEntries(SIDES.map((side) => {
    const name = h('span.cp-card__name');
    const badge = h('span.cp-card__badge');
    const text = h('p.cp-card__text');
    const body = h('div.cp-card__body', { tabindex: '0' }, text);
    const foot = h('div.cp-card__foot');
    const el = h('article.cp-card', { dataset: { side } }, h('header.cp-card__head', name, badge), body, foot);
    return [side, { el, name, badge, text, body, foot, shownId: null }];
  }));
  pairEl.append(cards.left.el, cards.right.el);

  // ----- pick and annotate -----
  function pick(id) {
    if (locked || nexting || voiceBusy() || picked === id) return;
    const before = picked;
    if (before && note) logEvent('compare.noteDiscarded', { versionId: before, chars: note.length });
    picked = id;
    note = '';
    noteError = null;
    logEvent('compare.picked', { versionId: id, side: sideOf(id), step: state.step, switched: Boolean(before), kept: state.kept === id });
    render();
  }

  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: micBtn,
      log: () => ({ target: 'compare', versionId: picked }),
      busy: (key, on) => setBusy(`voice:${key}`, on),
      onStart() { noteError = null; recordingSeconds = 0; render(); },
      onTick(s) { recordingSeconds = Math.floor(s); updateNote(); },
      onStop() { recordingSeconds = null; render(); },
      onTranscribing(on) { transcribing = on; render(); },
      onText(text) {
        if (!picked) return;
        note = note ? `${note} ${text}` : text;
        logEvent('compare.noted', { versionId: picked, chars: text.length, totalChars: note.length });
        render();
      },
      onFail(key, retry) { recordingSeconds = null; noteError = { key, retry }; render(); },
    });
  }

  // The note area of the picked card. Built once and only updated, so a re-render never takes the
  // microphone out of the page while it is held.
  const noteLabel = h('div.cp-note__label');
  const noteText = h('p.cp-note__text');
  const noteClear = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', title: t('compare.clearNote'), 'aria-label': t('compare.clearNote') }, icon('sys-cancel'));
  noteClear.addEventListener('click', () => { logEvent('compare.noteCleared', { chars: note.length }); note = ''; render(); });
  const noteStatus = h('div.cp-note__status', { 'aria-live': 'polite' });
  const noteEl = h('div.cp-note', h('div.cp-note__row', micBtn, h('div.cp-note__main', noteLabel, noteText), noteClear), noteStatus);

  function updateNote() {
    const recording = recordingSeconds !== null;
    noteLabel.textContent = recording ? t('canvas.recordingStatus', { seconds: recordingSeconds }) : t(ptt ? 'compare.noteHold' : 'compare.noteStart');
    micBtn.setAttribute('aria-label', t(ptt ? 'compare.noteHold' : 'compare.noteStart'));
    if (input) {
      if (input.recording) micBtn.disabled = locked;
      else input.setEnabled(Boolean(picked) && !locked && !transcribing && !nexting);
    } else micBtn.disabled = true;
    noteText.textContent = note || t('compare.noteHint');
    noteText.classList.toggle('is-empty', !note);
    noteClear.hidden = !note || voiceBusy() || Boolean(nexting);
    clear(noteStatus);
    if (transcribing) noteStatus.append(busy(t('canvas.transcribing')));
    else if (noteError) {
      noteStatus.append(messageStrip('error', t(`canvas.errors.${noteError.key}`)));
      if (noteError.retry) noteStatus.append(h('button.fh-btn', { type: 'button', onclick: () => { const r = noteError.retry; noteError = null; r(); } }, t('common.retry')));
    }
    noteStatus.hidden = !noteStatus.firstChild;
  }

  // ----- next round -----
  async function next() {
    if (!picked || !note || locked || nexting || voiceBusy()) return;
    const keptId = picked;
    const leavingSide = SIDES.find((s) => versionAt(s)?.id !== keptId);
    const annotation = note;
    nexting = { keptId, leavingSide };
    error = null;
    setBusy('next', true);
    render();
    const started = performance.now();
    logEvent('compare.next', { step: state.step, kept: keptId, rejected: versionAt(leavingSide)?.id, side: sideOf(keptId), chars: annotation.length });
    try {
      const res = await api.compare.next(round, keptId, annotation, AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000));
      if (destroyed) return;
      state = res;
      picked = null;
      note = '';
      // The profile and the new version's differences are logged by the server (server.compare.next).
      logEvent('compare.newVersion', { step: state.step, versionId: versionAt(leavingSide)?.id, latencyMs: Math.round(performance.now() - started), mock: res.mock });
    } catch (e) {
      if (destroyed) return;
      logEvent('compare.nextFailed', { error: e.code ?? e.name });
      error = { key: errorKey(e) ?? 'compareNext', retry: next };
    } finally {
      nexting = null;
      setBusy('next', false);
      if (!destroyed) render();
    }
  }
  nextBtn.addEventListener('click', next);

  async function accept() {
    if (!picked || locked || nexting || voiceBusy()) return;
    try {
      state = await api.compare.accept(round, picked);
      logEvent('compare.accepted', { versionId: picked, step: state.step, picks: state.picks, noteChars: note.length });
    } catch (e) {
      logEvent('compare.acceptFailed', { error: e.code ?? e.name });
    }
    if (destroyed) return;
    render();
    canvasApi.onFinishRequest?.();
  }
  acceptBtn.addEventListener('click', accept);

  // ----- render -----
  function fillText(card, v, other) {
    const key = `${v.id}|${showDiff ? other?.id ?? '' : ''}`;
    if (card.shownId === key) return;
    card.shownId = key;
    clear(card.text);
    if (!showDiff || !other) { card.text.textContent = v.text; return; }
    let pos = 0;
    for (const r of changedRanges(other.text, v.text)) {
      if (r.start > pos) card.text.append(v.text.slice(pos, r.start));
      card.text.append(h('mark.cp-diffmark', v.text.slice(r.start, r.end)));
      pos = r.end;
    }
    card.text.append(v.text.slice(pos));
  }

  function renderCard(side) {
    const card = cards[side];
    const v = versionAt(side);
    const other = versionAt(side === 'left' ? 'right' : 'left');
    const leaving = nexting?.leavingSide === side;
    const isPicked = Boolean(v) && picked === v.id;
    card.el.classList.toggle('is-picked', isPicked);
    card.el.classList.toggle('is-other', Boolean(picked) && !isPicked);
    card.el.classList.toggle('is-leaving', leaving);
    card.el.classList.toggle('is-accepted', Boolean(v) && state?.accepted === v.id);
    if (!v || loading || leaving) {
      clear(card.foot);
      card.name.textContent = leaving ? t('compare.leaving') : '';
      card.badge.textContent = '';
      card.badge.hidden = true;
      card.shownId = null;
      clear(card.text).append(busy(t(leaving ? 'compare.writingNext' : 'compare.writingFirst')));
      card.el.classList.remove('is-new');
      return;
    }
    // A version that just arrived slides in once.
    const isNew = state.step > 1 && v.step === state.step && state.kept !== v.id;
    if (card.el.dataset.version !== v.id) {
      card.el.dataset.version = v.id;
      if (isNew) { card.el.classList.remove('is-new'); void card.el.offsetWidth; card.el.classList.add('is-new'); }
      card.body.scrollTop = 0;
    }
    card.name.textContent = t('compare.versionLabel', { n: v.n });
    const badge = state.accepted === v.id ? t('compare.badgeAccepted') : state.kept === v.id ? t('compare.badgeKept') : isNew ? t('compare.badgeNew') : '';
    card.badge.textContent = badge;
    card.badge.hidden = !badge;
    card.badge.dataset.kind = state.accepted === v.id ? 'accepted' : state.kept === v.id ? 'kept' : 'new';
    fillText(card, v, other);
    if (isPicked) {
      updateNote();
      if (card.foot.firstChild !== noteEl) clear(card.foot).append(noteEl);
    } else {
      clear(card.foot);
      const btn = h('button.fh-btn.cp-pick', { type: 'button', disabled: locked || Boolean(nexting) || voiceBusy() },
        icon('favorite'), h('span', t(picked ? 'compare.pickInstead' : 'compare.pick')));
      btn.addEventListener('click', () => pick(v.id));
      card.foot.append(btn);
    }
  }

  function render() {
    if (destroyed) return;
    const ready = Boolean(state?.pair) && !loading;
    stepText.textContent = !ready ? t('compare.stepLoading')
      : nexting ? t('compare.stepNext')
      : t(picked ? (note ? 'compare.stepReady' : 'compare.stepNote') : 'compare.stepPick', { n: state.step });
    diffBtn.hidden = !ready;
    diffBtn.setAttribute('aria-pressed', String(showDiff));
    SIDES.forEach(renderCard);
    clear(noticeSlot);
    if (error) {
      noticeSlot.append(h('div.ic-error', messageStrip('error', t(`canvas.errors.${error.key}`)),
        error.retry ? h('div', h('button.fh-btn', { type: 'button', onclick: () => { const r = error.retry; error = null; r(); } }, t('common.retry'))) : null));
    }
    nextBtn.disabled = locked || !ready || !picked || !note || Boolean(nexting) || voiceBusy();
    nextBtn.title = !picked ? t('compare.needPick') : !note ? t('compare.needNote') : '';
    acceptBtn.disabled = locked || !ready || !picked || Boolean(nexting) || voiceBusy();
    acceptBtn.title = picked ? '' : t('compare.needPick');
    finishBtn.disabled = locked;
  }

  // ----- first pair -----
  async function start() {
    loading = true;
    error = null;
    setBusy('start', true);
    render();
    try {
      const res = await api.compare.start(round, AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000));
      if (destroyed) return;
      state = res;
      if (res.generating) {
        // Being written (e.g. the page was reloaded meanwhile): ask again shortly.
        pollTimer = setTimeout(start, 2000);
        return;
      }
      logEvent('compare.shown', { step: state.step, left: versionAt('left')?.id, right: versionAt('right')?.id, resumed: state.picks > 0 || state.step > 1 });
      loading = false;
      setBusy('start', false);
    } catch (e) {
      if (destroyed) return;
      logEvent('compare.startFailed', { error: e.code ?? e.name });
      loading = false;
      setBusy('start', false);
      error = { key: errorKey(e) ?? 'compareStart', retry: start };
    }
    render();
  }

  // ----- assemble -----
  const el = h('div.vc.cp', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls);
  render();
  if (live) start();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, output: pairEl, send: nextBtn, accept: acceptBtn, timer: timerSlot, finish: finishBtn },
    getRegion(name) { return this.regions[name]; },
    isBusy: () => work.size > 0,
    whenIdle: () => (work.size ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve()),
    setLocked(on) {
      locked = on;
      render();
    },
    stopRecording(reason) { input?.stop(reason); },
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      input?.destroy();
      waiters.splice(0).forEach((fn) => fn());
    },
  });
}
