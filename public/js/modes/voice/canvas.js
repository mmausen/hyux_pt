// Voice mode canvas: task panel (top, fixed), conversation with the assistant (middle; each turn pairs the
// AI response with the spoken instruction that produced it, older turns fade), and the controls (bottom:
// record, send, finish, timer slot). Input is voice only: the draft is built from transcribed recordings
// and cannot be edited by typing.
//
// createCanvas(ctx, { round, task, live, conceal, sample, showFinish, onTurn }) → {
//   el, timerSlot, noticeSlot, regions (task, record, transcript, send, output, timer, finish), onFinishRequest,
//   isBusy(), setLocked(bool), stopRecording(reason), whenIdle(), destroy()
// }
// live=false renders the same layout without input (briefing backdrop, tutorial). conceal hides the task text.
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { sendChat } from '../../core/aiClient.js';
import { logEvent } from '../../core/logEvent.js';
import { createRecorder } from '../../core/recorder/index.js';

// Opacity of a turn by age (0 = latest). The step from the latest to the one before is large on purpose,
// so the current response stands out; hovering or focusing a turn shows it at full strength.
const FADE = [1, 0.45, 0.35, 0.3];

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

export function createCanvas(ctx, { round, task, live = true, conceal = false, sample = null, showFinish = true, onTurn = null }) {
  const { config, session } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';
  const assistant = config.ai.assistantName;

  // ----- state -----
  const serverTurns = () => session.data?.rounds?.[String(round)]?.turns ?? [];
  let turns = sample ? sample.turns : serverTurns().filter((x) => x.status === 'done');
  let draft = sample ? (sample.draft ? [{ text: sample.draft }] : []) : [...(session.roundState(round).draft ?? [])];
  let inflight = null; // { transcript, response, status: 'pending' }
  let transcribing = false;
  let finalizing = false; // recorder stopped by the app, audio not yet handed to transcription
  let transcriptError = null; // { key, retry }
  let chatError = null; // { key }
  let locked = !live;
  let destroyed = false;
  let aborter = null;
  let pollTimer = null;
  const idleWaiters = [];

  const draftText = () => draft.map((d) => d.text).join(' ').trim();
  const saveDraft = () => live && session.updateRound(round, { draft }, { immediate: true });
  const isIdle = () => !transcribing && !inflight && !finalizing;
  const notifyIdle = () => { if (isIdle()) idleWaiters.splice(0).forEach((fn) => fn()); };

  // ----- task panel -----
  const materials = Array.isArray(task?.materials) ? task.materials : [];
  const materialsBody = h('div.vc-materials', { id: `vc-materials-${round}`, hidden: true },
    materials.map((m) => h('section.vc-material', h('h3.vc-material__title', m.title), h('p.vc-material__body', m.body))));
  const materialsBtn = materials.length && !conceal ? h('button.fh-btn.fh-btn--transparent', { type: 'button', 'aria-expanded': 'false', 'aria-controls': materialsBody.id },
    icon('slim-arrow-down'), h('span', t('canvas.showMaterials'))) : null;
  materialsBtn?.addEventListener('click', () => {
    const open = materialsBody.hidden;
    materialsBody.hidden = !open;
    materialsBtn.setAttribute('aria-expanded', String(open));
    materialsBtn.firstChild.dataset.icon = open ? 'slim-arrow-up' : 'slim-arrow-down';
    materialsBtn.lastChild.textContent = t(open ? 'canvas.hideMaterials' : 'canvas.showMaterials');
    if (live) logEvent(open ? 'materials.opened' : 'materials.closed', {});
  });

  const taskPanel = h('section.vc-task', { 'aria-label': t('canvas.taskLabel'), dataset: { region: 'task' } },
    h('div.vc-task__head', h('h1.vc-task__title', task?.title ?? ''), materialsBtn),
    conceal ? null : h('div.vc-task__body',
      h('div.vc-task__block', h('div.vc-task__label', t('canvas.taskLabel')), h('p.vc-task__text.vc-task__text--strong', task?.task ?? '')),
      h('div.vc-task__block', h('div.vc-task__label', t('canvas.situationLabel')), h('p.vc-task__text', task?.situation ?? ''))),
    conceal ? null : materialsBody);

  // ----- conversation -----
  const noticeSlot = h('div.vc-notices');
  const turnList = h('ol.vc-turns');
  const scroller = h('div.vc-convo__scroll', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, turnList);
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot, scroller);

  const agentAvatar = () => h('span.fh-agent-avatar.fh-agent-avatar--xs', { 'aria-hidden': 'true' }, icon('ai'));
  const busy = (text) => h('div.fh-msg-agent__thinking', h('span.fh-busy', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), text);

  function responseBlock(turn, { streaming = false } = {}) {
    const body = h('div.fh-msg-agent__body');
    if (streaming && !turn.response) body.append(busy(t('canvas.working')));
    else body.append(h('p.vc-response', turn.response));
    return h('div.fh-msg-agent.vc-turn__response', agentAvatar(), h('div.vc-turn__agent',
      h('div.vc-turn__meta', h('span.vc-turn__name', assistant), turn.n ? h('span', t('canvas.turnLabel', { n: turn.n })) : null),
      body));
  }

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

  function render() {
    if (destroyed) return;
    clear(turnList);
    const doneCount = turns.length;
    turns.forEach((turn, i) => {
      const age = doneCount - 1 - i + (inflight ? 1 : 0);
      turnList.append(h('li.vc-turn', { style: `--vc-opacity:${FADE[Math.min(age, FADE.length - 1)]}`, dataset: { age: String(age) } },
        responseBlock(turn), instructionBlock(turn)));
    });
    if (inflight) {
      turnList.append(h('li.vc-turn.vc-turn--current', responseBlock(inflight, { streaming: true }), instructionBlock(inflight)));
    } else {
      const placeholder = doneCount === 0
        ? h('div.vc-turn__response.vc-placeholder', agentAvatar(), h('p', t('canvas.responsePlaceholder')))
        : h('div.vc-turn__response');
      const errorBox = chatError ? h('div.vc-chat-error', messageStrip('error', t(`canvas.errors.${chatError.key}`))) : null;
      turnList.append(h('li.vc-turn.vc-turn--current', h('div.vc-turn__left', placeholder, errorBox), draftBlock()));
    }
    renderControls();
    scroller.scrollTop = scroller.scrollHeight;
  }

  // Streaming updates only touch the response text, not the whole list.
  function renderDelta() {
    const current = turnList.lastElementChild;
    const body = current?.querySelector('.fh-msg-agent__body');
    if (!body) return render();
    const p = body.querySelector('.vc-response');
    if (p) p.textContent = inflight.response;
    else clear(body).append(h('p.vc-response', inflight.response));
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
  }

  // ----- controls -----
  const meterFill = h('span', { style: 'width:0%' });
  const meter = h('div.fh-progress.vc-meter', { 'aria-hidden': 'true' }, meterFill);
  const recLabel = h('span.vc-rec__label');
  const recStatus = h('span.vc-rec__status', { 'aria-live': 'polite' });
  const recButton = h('button.app-record.vc-rec__button', { type: 'button', dataset: { region: 'record' } }, icon('microphone', 'fh-icon--l'));
  const sendBtn = h('button.fh-btn.fh-btn--emphasized.vc-send', { type: 'button', dataset: { region: 'send' } }, icon('ai'), h('span', t('canvas.send')));
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  function setRecIdleLabel() {
    recLabel.textContent = t(ptt ? 'canvas.recordHold' : 'canvas.recordStart');
    recButton.setAttribute('aria-label', ptt ? `${recLabel.textContent} (${t('canvas.recordHintPushToTalk')})` : recLabel.textContent);
    recStatus.textContent = ptt ? t('canvas.recordHintPushToTalk') : '';
  }
  setRecIdleLabel();

  function renderControls() {
    const canRecord = !locked && !transcribing && !inflight;
    if (recorder) {
      if (recorder.recording) recButton.disabled = locked;
      else recorder.setEnabled(canRecord);
    } else recButton.disabled = true;
    sendBtn.disabled = locked || !draftText() || transcribing || Boolean(inflight) || recorder?.recording;
    finishBtn.disabled = locked;
  }

  const controls = h('footer.vc-controls',
    h('div.vc-controls__row',
      h('div.vc-controls__side'),
      h('div.vc-controls__main',
        h('div.vc-rec', recButton, h('div.vc-rec__text', recLabel, recStatus, meter)),
        sendBtn),
      h('div.vc-controls__side.vc-controls__side--end', finishBtn)),
    timerSlot);

  // ----- recording + transcription -----
  let recorder = null;

  async function transcribe(rec) {
    transcribing = true;
    transcriptError = null;
    chatError = null;
    render();
    const started = performance.now();
    try {
      const res = await api.transcribe(rec.blob, { round, filename: `recording.${rec.ext}`, signal: AbortSignal.timeout((config.stt.timeoutSeconds + 5) * 1000) });
      if (destroyed) return;
      const text = (res.text ?? '').trim();
      const latencyMs = Math.round(performance.now() - started);
      if (!text) {
        transcriptError = { key: 'empty' };
        logEvent('transcript.empty', { recordingMs: rec.durationMs, latencyMs, reason: rec.reason });
      } else {
        draft.push({ text, at: new Date().toISOString(), recordingMs: rec.durationMs });
        saveDraft();
        logEvent('transcript.received', { text, recordingMs: rec.durationMs, latencyMs, reason: rec.reason, segment: draft.length, mock: res.mock });
      }
    } catch (e) {
      if (destroyed) return;
      logEvent('transcript.failed', { error: e.code ?? e.name, reason: rec.reason });
      transcriptError = { key: e.code === 'rate_limited' ? 'rateLimited' : 'transcribe', retry: () => transcribe(rec) };
    } finally {
      transcribing = false;
      if (!destroyed) render();
      notifyIdle();
    }
  }

  if (live) {
    recorder = createRecorder(config.interaction.recordingMode, {
      maxSeconds: config.interaction.maxRecordingSeconds,
      onStart() {
        transcriptError = null;
        chatError = null;
        recLabel.textContent = t(ptt ? 'canvas.recordHold' : 'canvas.recordStop');
        recStatus.textContent = t('canvas.recordingStatus', { seconds: 0 });
        logEvent('recording.start', { mode: recorder.mode });
        renderControls();
      },
      onTick(s) { recStatus.textContent = t('canvas.recordingStatus', { seconds: Math.floor(s) }); },
      onLevel(level) { meterFill.style.width = `${Math.round(level * 100)}%`; },
      onStop(rec) {
        finalizing = false;
        setRecIdleLabel();
        logEvent('recording.stop', { durationMs: rec.durationMs, reason: rec.reason, bytes: rec.blob.size, mimeType: rec.mimeType, peak: Math.round(rec.peak * 100) / 100 });
        if (destroyed && rec.reason !== 'timeLimit') { notifyIdle(); return; }
        if (rec.tooShort || !rec.blob.size) {
          transcriptError = { key: 'tooShort' };
          render();
          notifyIdle();
          return;
        }
        if (rec.reason === 'maxLength') recStatus.textContent = t('canvas.recordingMax', { seconds: config.interaction.maxRecordingSeconds });
        transcribe(rec);
      },
      onError(err) {
        finalizing = false;
        notifyIdle();
        setRecIdleLabel();
        logEvent('recording.error', { error: err.kind ?? err.name });
        transcriptError = { key: 'mic' };
        render();
      },
    });
    recorder.attach(recButton);
  }

  // ----- send to AI -----
  async function send() {
    const text = draftText();
    if (!text || locked || inflight || transcribing) return;
    chatError = null;
    inflight = { n: turns.length + 1, transcript: text, response: '', status: 'pending', sentAt: new Date().toISOString() };
    render();
    logEvent('ai.sent', { turn: inflight.n, text, chars: text.length, segments: draft.length });
    aborter = new AbortController();
    const started = performance.now();
    let firstToken = null;
    try {
      const turn = await sendChat({
        round,
        text,
        signal: aborter.signal,
        onDelta(d) {
          if (firstToken === null) firstToken = Math.round(performance.now() - started);
          inflight.response += d;
          renderDelta();
        },
      });
      if (destroyed) return;
      turns.push(turn);
      storeTurnLocally(turn);
      draft = [];
      saveDraft();
      logEvent('ai.received', { turn: turn.n, latencyMs: Math.round(performance.now() - started), firstTokenMs: firstToken, chars: turn.response.length, mock: turn.mock });
      onTurn?.(turn);
    } catch (e) {
      if (destroyed || e.name === 'AbortError') return;
      const key = e.code === 'llm_timeout' ? 'timeout' : e.code === 'rate_limited' ? 'rateLimited' : 'chat';
      chatError = { key };
      logEvent('ai.failed', { error: e.code ?? e.name });
    } finally {
      inflight = null;
      aborter = null;
      if (!destroyed) render();
      notifyIdle();
    }
  }
  sendBtn.addEventListener('click', send);

  function storeTurnLocally(turn) {
    if (!session.data) return;
    const key = String(round);
    const rounds = session.data.rounds ?? (session.data.rounds = {});
    const r = rounds[key] ?? (rounds[key] = { turns: [] });
    r.turns = [...r.turns.filter((x) => x.n !== turn.n), turn];
  }

  // A turn still pending on the server (page reloaded while the AI was answering): wait for it.
  function resumePending() {
    const pending = serverTurns().find((x) => x.status === 'pending');
    if (!pending || !live) return;
    inflight = { ...pending };
    const deadline = Date.now() + (config.ai.timeoutSeconds + 15) * 1000;
    const poll = async () => {
      if (destroyed) return;
      try {
        const data = await api.getSession();
        session.set(data);
        const t2 = (data.rounds?.[String(round)]?.turns ?? []).find((x) => x.n === pending.n);
        if (t2?.status === 'done') {
          turns.push(t2);
          if (draftText() === t2.transcript) { draft = []; saveDraft(); }
          onTurn?.(t2);
          inflight = null;
        } else if (!t2 || Date.now() > deadline) {
          inflight = null;
          chatError = { key: 'pendingLost' };
        }
      } catch { /* try again */ }
      if (inflight) pollTimer = setTimeout(poll, 2000);
      else { render(); notifyIdle(); }
    };
    pollTimer = setTimeout(poll, 1000);
  }

  // ----- assemble -----
  const el = h('div.vc', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls);
  resumePending();
  render();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, record: recButton.parentElement, transcript: null, send: sendBtn, output: convo, timer: timerSlot, finish: finishBtn },
    getRegion(name) { return name === 'transcript' ? el.querySelector('[data-region="transcript"]') : this.regions[name]; },
    isBusy: () => !isIdle(),
    setLocked(on) {
      locked = on;
      renderControls();
      if (!inflight) render();
    },
    stopRecording(reason) {
      if (recorder?.recording || recorder?._starting) {
        finalizing = true;
        recorder.stop(reason);
      }
    },
    whenIdle() {
      return isIdle() ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
    },
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      recorder?.destroy();
      // An in-flight chat request is not aborted: the server stores the turn either way.
      idleWaiters.splice(0).forEach((fn) => fn());
    },
  });
}
