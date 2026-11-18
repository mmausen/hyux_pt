// Slider mode canvas: task (top), the AI's output (left), a slot machine of sliders (right), timer (bottom).
//
//   Start: the task's starting draft (turn 1) and its sliders (task.sliders), both from /api/slider/start.
//   Each slider is a reel with five stops between its two poles: strongly a, leaning a, balanced, leaning
//   b, strongly b. It turns with its arrows, the mouse wheel, dragging, the arrow keys or a click on a stop.
//   Send Settings (at the base of the machine) writes a version from all positions (/api/chat with
//   { sliders }); reels moved since the last version are marked, and the words that changed in the new
//   version are highlighted. The same positions always give the same text (the server caches it).
//   The microphone at the base adds a slider (the AI finds the two poles of what was said) or removes one.
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createConversation } from '../../core/conversation.js';
import { createTaskPanel } from '../../core/canvas/taskPanel.js';
import { createLatestResponse, busy } from '../../core/canvas/latestResponse.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';
import { changedRanges } from './diff.js';

const STOPS = 5;
const BALANCED = 2;
const errorKey = (e) => (e?.code === 'rate_limited' ? 'rateLimited' : e?.code === 'llm_timeout' || e?.name === 'TimeoutError' ? 'timeout' : null);

export function createCanvas(ctx, { round, task, live = true, conceal = false, showFinish = true, onTurn = null }) {
  const { config, session } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  // ----- state -----
  let sliders = []; // [{ id, theme, a, b, source }] (the server's list)
  let values = { ...(session.progress(round).sliderValues ?? {}) }; // id → 0..4
  let starting = false;
  let startError = false;
  let transcribing = false;
  let thinking = null; // transcript being turned into a slider change
  let voiceResult = null; // { kind, vars } shown under the reels
  let voiceError = null; // { key, retry }
  let recordingSeconds = null;
  let showChanges = true;
  let freshId = null; // a slider just added (animated once)
  let locked = !live;
  let destroyed = false;

  const conv = createConversation(ctx, {
    round,
    live,
    onUpdate: () => render(),
    onDelta: (text) => { if (!response.delta(text)) render(); },
    onTurn(turn, info) {
      response.markUpdated();
      onTurn?.(turn, info);
    },
  });

  const valueOf = (id) => (Number.isInteger(values[id]) ? values[id] : BALANCED);
  const lastSliderTurn = () => [...conv.turns].reverse().find((x) => x.kind === 'slider') ?? null;
  const saveValues = () => live && session.updateProgress(round, { sliderValues: values });
  // A reel counts as moved when its position differs from the last version (or it is new since then).
  function moved(s) {
    const last = lastSliderTurn();
    if (!last) return false;
    const before = last.sliders?.find((x) => x.id === s.id);
    return !before || before.value !== valueOf(s.id);
  }
  function settingsChanged() {
    const last = lastSliderTurn();
    if (!last) return true;
    if ((last.sliders ?? []).some((x) => !sliders.some((s) => s.id === x.id))) return true; // one was removed
    return sliders.some(moved);
  }
  const voiceBusy = () => transcribing || Boolean(thinking) || recordingSeconds !== null;

  // ----- layout -----
  const taskPanel = createTaskPanel({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const changesBtn = h('button.fh-btn.fh-btn--transparent.sl-changes', { type: 'button', 'aria-pressed': 'true' }, icon('show-edit'), h('span', t('slider.showChanges')));
  changesBtn.addEventListener('click', () => {
    showChanges = !showChanges;
    logEvent('slider.changesToggled', { on: showChanges });
    render();
  });
  const outputBody = h('div');
  const scroller = h('div.vc-convo__scroll.sl-output', { tabindex: '0', 'aria-label': t('canvas.conversationLabel') }, outputBody);
  const response = createLatestResponse({
    assistant: config.ai.assistantName, scroller, latest: conv.turns.at(-1),
    label: (turn) => {
      if (turn.kind === 'scaffold') return t('canvas.scaffoldLabel');
      const n = conv.turns[0]?.kind === 'scaffold' ? turn.n - 1 : turn.n;
      const from = turn.cachedFrom ? conv.turns.find((x) => x.n === turn.cachedFrom) : null;
      return from ? t('slider.versionSame', { n, m: conv.turns[0]?.kind === 'scaffold' ? from.n - 1 : from.n }) : turn.n ? t('canvas.versionLabel', { n }) : null;
    },
  });

  const reelsEl = h('div.sl-reels');
  const machineCount = h('span.ic-panel__count');
  const voiceStatus = h('div.sl-voice', { 'aria-live': 'polite' });
  const micBtn = h('button.app-record.sl-mic', { type: 'button', dataset: { region: 'record' } }, icon('microphone'));
  const micLabel = h('span.sl-base__label');
  const sendText = h('span', t('slider.send'));
  const sendBtn = h('button.fh-btn.fh-btn--emphasized.vc-send.sl-send', { type: 'button', dataset: { region: 'send' } }, icon('ai'), sendText);
  const machine = h('aside.sl-machine', { dataset: { region: 'sliders' }, 'aria-label': t('slider.machineLabel') },
    h('div.ic-panel__head', h('div.vc-instruction__label', t('slider.machineLabel')), machineCount),
    reelsEl,
    voiceStatus,
    h('div.sl-base', h('div.sl-base__voice', micBtn, micLabel), sendBtn));
  const convo = h('section.vc-convo', { dataset: { region: 'output' } }, noticeSlot,
    h('div.sl-layout', h('div.sl-left', h('div.sl-left__bar', changesBtn), scroller), machine));

  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const controls = h('footer.vc-controls.sl-controls',
    h('div.vc-controls__row', h('div.vc-controls__side'), h('div.vc-controls__main'), h('div.vc-controls__side.vc-controls__side--end', finishBtn)),
    timerSlot);
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  // ----- reels -----
  // A reel keeps its DOM across renders (so turning it animates); render() only updates it.
  const reels = new Map();
  const stopLabel = (i) => t(i === BALANCED ? 'slider.balanced' : i === 0 || i === STOPS - 1 ? 'slider.strongly' : 'slider.leaning');
  const valueText = (s, v) => (v === BALANCED ? t('slider.balancedBetween', { a: s.a, b: s.b }) : `${stopLabel(v)}: ${v < BALANCED ? s.a : s.b}`);

  function setValue(id, next, via) {
    const s = sliders.find((x) => x.id === id);
    const from = valueOf(id);
    const to = Math.max(0, Math.min(STOPS - 1, next));
    if (!s || to === from || locked || conv.inflight) return;
    values = { ...values, [id]: to };
    saveValues();
    logEvent('slider.moved', { id, theme: s.theme, from, to, via });
    render();
  }

  function createReel(s) {
    const strip = h('div.sl-reel__strip', [...Array(STOPS)].map((_, i) => h('div.sl-reel__item', { dataset: { stop: String(i) } },
      i === BALANCED ? null : icon(i < BALANCED ? 'slim-arrow-up' : 'slim-arrow-down', 'sl-reel__dir'), h('span', stopLabel(i)))));
    const win = h('div.sl-reel__window', { role: 'slider', tabindex: '0', 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': String(STOPS - 1) },
      strip, h('div.sl-reel__band', { 'aria-hidden': 'true' }));
    const up = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.sl-reel__turn', { type: 'button' }, icon('slim-arrow-up'));
    const down = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.sl-reel__turn', { type: 'button' }, icon('slim-arrow-down'));
    const themeEl = h('div.sl-reel__theme', h('span.sl-reel__dot', { 'aria-hidden': 'true' }), h('span.sl-reel__themeText'));
    const poleA = h('div.sl-reel__pole');
    const poleB = h('div.sl-reel__pole');
    const el = h('div.sl-reel', { role: 'group', dataset: { slider: s.id } }, themeEl, poleA, up, win, down, poleB);

    up.addEventListener('click', () => setValue(s.id, valueOf(s.id) - 1, 'button'));
    down.addEventListener('click', () => setValue(s.id, valueOf(s.id) + 1, 'button'));
    strip.addEventListener('click', (e) => {
      const stop = e.target.closest('.sl-reel__item')?.dataset.stop;
      if (stop !== undefined && !dragged) setValue(s.id, Number(stop), 'click');
    });
    win.addEventListener('keydown', (e) => {
      const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (step) { e.preventDefault(); setValue(s.id, valueOf(s.id) + step, 'key'); }
      if (e.key === 'Home') { e.preventDefault(); setValue(s.id, 0, 'key'); }
      if (e.key === 'End') { e.preventDefault(); setValue(s.id, STOPS - 1, 'key'); }
    });
    // Mouse wheel: one stop per notch (trackpads send many small events, so they are summed up).
    let wheel = 0;
    win.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) >= 40) {
        setValue(s.id, valueOf(s.id) + Math.sign(wheel), 'wheel');
        wheel = 0;
      }
    }, { passive: false });
    // Dragging the reel: one stop per item height.
    let drag = null;
    let dragged = false;
    win.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { y: e.clientY, start: valueOf(s.id), item: strip.firstChild.offsetHeight || 36, id: e.pointerId };
      dragged = false;
    });
    win.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // Captured only once it is a drag, so a plain click still reaches the stop it is on.
      if (!win.hasPointerCapture(drag.id) && Math.abs(e.clientY - drag.y) > 4) win.setPointerCapture(drag.id);
      const steps = Math.round((drag.y - e.clientY) / drag.item);
      if (steps) dragged = true;
      // Dragging the strip up shows the next stop below: towards b.
      const target = Math.max(0, Math.min(STOPS - 1, drag.start + steps));
      if (target !== valueOf(s.id)) setValue(s.id, target, 'drag');
    });
    const end = () => { drag = null; setTimeout(() => { dragged = false; }, 0); };
    win.addEventListener('pointerup', end);
    win.addEventListener('pointercancel', end);

    return { el, s, strip, win, up, down, themeEl, poleA, poleB };
  }

  function updateReel(reel, s) {
    const v = valueOf(s.id);
    const disabled = locked || Boolean(conv.inflight) || starting;
    reel.s = s;
    reel.themeEl.lastChild.textContent = s.theme;
    reel.poleA.textContent = s.a;
    reel.poleB.textContent = s.b;
    reel.strip.style.setProperty('--sl-value', String(v));
    [...reel.strip.children].forEach((item, i) => item.classList.toggle('is-current', i === v));
    reel.win.setAttribute('aria-label', s.theme);
    reel.win.setAttribute('aria-valuenow', String(v));
    reel.win.setAttribute('aria-valuetext', valueText(s, v));
    reel.win.setAttribute('aria-disabled', String(disabled));
    reel.win.tabIndex = disabled ? -1 : 0;
    reel.up.disabled = disabled || v === 0;
    reel.down.disabled = disabled || v === STOPS - 1;
    reel.up.title = t('slider.towards', { pole: s.a });
    reel.up.setAttribute('aria-label', `${s.theme}: ${reel.up.title}`);
    reel.down.title = t('slider.towards', { pole: s.b });
    reel.down.setAttribute('aria-label', `${s.theme}: ${reel.down.title}`);
    reel.el.classList.toggle('is-moved', moved(s));
    reel.el.classList.toggle('is-disabled', disabled);
    reel.el.setAttribute('aria-label', s.theme);
    reel.themeEl.title = moved(s) ? t('slider.movedHint') : '';
  }

  function renderReels() {
    for (const [id, reel] of reels) if (!sliders.some((s) => s.id === id)) { reel.el.remove(); reels.delete(id); }
    sliders.forEach((s, i) => {
      if (!reels.has(s.id)) reels.set(s.id, createReel(s));
      const reel = reels.get(s.id);
      updateReel(reel, s);
      if (reelsEl.children[i] !== reel.el) reelsEl.insertBefore(reel.el, reelsEl.children[i] ?? null);
      if (s.id === freshId) { reel.el.classList.add('is-new'); freshId = null; }
    });
    machineCount.textContent = sliders.length ? t('slider.count', { n: sliders.length, max: config.ai.slider.maxSliders }) : '';
    reelsEl.classList.toggle('is-empty', !sliders.length);
    if (!sliders.length && !starting) reelsEl.dataset.empty = t(ptt ? 'slider.emptyPushToTalk' : 'slider.emptyToggle');
  }

  // ----- output -----
  function renderOutput() {
    const { inflight } = conv;
    const latest = conv.turns.at(-1);
    if (starting || startError) {
      clear(outputBody).append(h('div.vc-turn__left', starting ? busy(t('canvas.scaffoldLoading'))
        : h('div.ic-error', messageStrip('error', t('canvas.errors.scaffold')), h('div', h('button.fh-btn', { type: 'button', onclick: start }, t('common.retry'))))));
      changesBtn.hidden = true;
      return;
    }
    clear(outputBody).append(response.render({ inflight, latest, error: conv.error, placeholderKey: 'slider.placeholder' }));
    // The words that changed against the version before.
    const prev = conv.turns.at(-2);
    const canDiff = !inflight && latest?.kind === 'slider' && prev;
    changesBtn.hidden = !canDiff;
    changesBtn.setAttribute('aria-pressed', String(showChanges));
    if (!canDiff || !showChanges) return;
    const p = outputBody.querySelector('.vc-response');
    if (!p) return;
    const text = latest.response;
    const ranges = changedRanges(prev.response, text);
    clear(p);
    let pos = 0;
    for (const r of ranges) {
      if (r.start > pos) p.append(text.slice(pos, r.start));
      p.append(h('mark.sl-changed', text.slice(r.start, r.end)));
      pos = r.end;
    }
    p.append(text.slice(pos));
  }

  // ----- voice: add or remove a slider -----
  function renderVoice() {
    const recording = recordingSeconds !== null;
    micLabel.textContent = recording ? t('canvas.recordingStatus', { seconds: recordingSeconds })
      : t(ptt ? 'slider.voiceHold' : recording ? 'slider.voiceStop' : 'slider.voiceStart');
    micBtn.setAttribute('aria-label', t(ptt ? 'slider.voiceHold' : 'slider.voiceStart'));
    clear(voiceStatus);
    if (transcribing) voiceStatus.append(busy(t('canvas.transcribing')));
    else if (thinking) voiceStatus.append(busy(t('slider.thinking')), h('q.ic-pending__text', thinking));
    else if (voiceError) {
      voiceStatus.append(messageStrip('error', t(`canvas.errors.${voiceError.key}`)));
      if (voiceError.retry) voiceStatus.append(h('button.fh-btn', { type: 'button', onclick: () => { const r = voiceError.retry; voiceError = null; r(); } }, t('common.retry')));
    } else if (voiceResult) voiceStatus.append(messageStrip(voiceResult.design, t(voiceResult.key, voiceResult.vars)));
    voiceStatus.hidden = !voiceStatus.firstChild;
    if (input) {
      if (input.recording) micBtn.disabled = locked;
      else input.setEnabled(!locked && !transcribing && !thinking && !conv.inflight && !starting);
    } else micBtn.disabled = true;
  }

  async function voice(text) {
    thinking = text;
    voiceResult = null;
    voiceError = null;
    conv.setBusy('sliderVoice', true);
    render();
    const started = performance.now();
    try {
      const res = await api.slider.voice(round, text, AbortSignal.timeout((config.ai.timeoutSeconds + 5) * 1000));
      if (destroyed) return;
      const before = sliders.length;
      sliders = res.sliders;
      if (res.action === 'create') {
        values = { ...values, [res.slider.id]: BALANCED };
        saveValues();
        freshId = res.slider.id;
        voiceResult = { design: 'success', key: 'slider.added', vars: { theme: res.slider.theme, a: res.slider.a, b: res.slider.b } };
      } else if (res.action === 'remove') {
        const { [res.slider.id]: _gone, ...rest } = values;
        values = rest;
        saveValues();
        voiceResult = { design: 'success', key: 'slider.removed', vars: { theme: res.slider.theme } };
      } else if (res.action === 'full') voiceResult = { design: 'warning', key: 'slider.full', vars: { max: config.ai.slider.maxSliders } };
      else voiceResult = { design: 'information', key: 'slider.noChange', vars: {} };
      // The transcript and the slider are logged by the server (server.slider.voice).
      logEvent('slider.voice', { action: res.action, id: res.slider?.id, before, after: sliders.length, latencyMs: Math.round(performance.now() - started), mock: res.mock });
    } catch (e) {
      if (destroyed) return;
      logEvent('slider.voiceFailed', { error: e.code ?? e.name });
      voiceError = { key: errorKey(e) ?? 'sliderVoice', retry: () => voice(text) };
    } finally {
      thinking = null;
      conv.setBusy('sliderVoice', false);
      if (!destroyed) {
        render();
        voiceStatus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: micBtn,
      log: { target: 'slider' },
      busy: (key, on) => conv.setBusy(`voice:${key}`, on),
      onStart() { voiceError = null; voiceResult = null; recordingSeconds = 0; render(); },
      onTick(s) { recordingSeconds = Math.floor(s); renderVoice(); },
      onStop() { recordingSeconds = null; render(); },
      onTranscribing(on) { transcribing = on; render(); },
      onText(text) { voice(text); },
      onFail(key, retry) { recordingSeconds = null; voiceError = { key, retry }; render(); },
    });
  }

  // ----- send the settings -----
  async function send() {
    if (locked || conv.inflight || voiceBusy() || !sliders.length || !settingsChanged()) return;
    const settings = sliders.map((s) => ({ id: s.id, value: valueOf(s.id) }));
    const movedIds = sliders.filter(moved).map((s) => s.id);
    await conv.send(sliders.map((s) => `${s.theme}: ${valueText(s, valueOf(s.id))}`).join('\n'),
      { step: 'sliders', settings: sliders.map((s) => ({ id: s.id, theme: s.theme, value: valueOf(s.id) })), moved: movedIds },
      { sliders: settings });
  }
  sendBtn.addEventListener('click', send);

  // ----- render -----
  function render() {
    if (destroyed) return;
    renderOutput();
    renderReels();
    renderVoice();
    const ready = sliders.length > 0 && settingsChanged();
    sendBtn.disabled = locked || starting || Boolean(conv.inflight) || voiceBusy() || !ready;
    sendBtn.title = !sliders.length ? '' : ready ? '' : t('slider.sendSame');
    finishBtn.disabled = locked;
  }

  // ----- start: starting draft and sliders -----
  async function start() {
    starting = true;
    startError = false;
    conv.setBusy('start', true);
    render();
    try {
      const res = await api.slider.start(round);
      if (destroyed) return;
      sliders = res.sliders;
      // Positions saved before a reload win; otherwise those of the last version, else balanced.
      const last = lastSliderTurn();
      for (const s of sliders) {
        if (!Number.isInteger(values[s.id])) values[s.id] = last?.sliders?.find((x) => x.id === s.id)?.value ?? BALANCED;
      }
      if (res.turn) {
        const fresh = !conv.turns.length;
        conv.adopt(res.turn);
        if (fresh) logEvent('scaffold.shown', { chars: res.turn.response.length });
      }
      logEvent('sliders.shown', { sliders: sliders.map((s) => ({ id: s.id, theme: s.theme, value: valueOf(s.id) })) });
    } catch (e) {
      if (destroyed) return;
      startError = true;
      logEvent('scaffold.failed', { error: e.code ?? e.name });
    } finally {
      starting = false;
      conv.setBusy('start', false);
      if (!destroyed) render();
    }
  }

  // ----- assemble -----
  const el = h('div.vc.sl', { class: live ? '' : 'vc--static' }, taskPanel, convo, controls);
  render();
  if (live) start();

  return Object.assign(canvasApi, {
    el,
    timerSlot,
    noticeSlot,
    regions: { task: taskPanel, output: scroller, sliders: machine, record: micBtn, send: sendBtn, timer: timerSlot, finish: finishBtn },
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
      input?.destroy();
      response.destroy();
      conv.destroy();
    },
  });
}
