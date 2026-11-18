// System check: three sequential checks (microphone → speech-to-text → LLM), each pending → running →
// success | failed. The participant records the test sentence with the configured recording mode, so
// this screen also introduces the record button. Continue is enabled when all three checks pass.
import { h, icon, clear, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';
import { logEvent } from '../core/logEvent.js';
import { createRecorder, getMicStream, MicError, SPEECH_LEVEL, micLabel } from '../core/recorder/index.js';

const CHECKS = ['mic', 'stt', 'llm'];

function browserFamily() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\/|Chrome\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export default function create() {
  let recorder = null;
  let aborter = null;
  let destroyed = false;

  return {
    mount(container, ctx) {
      const cfg = ctx.config.systemCheck;
      const ptt = ctx.config.interaction.recordingMode === 'pushToTalk';
      const checks = Object.fromEntries(CHECKS.map((k) => [k, { state: 'pending', text: '', error: null, failures: 0, retry: null }]));
      let lastBlob = null;

      // ----- UI -----
      const rows = Object.fromEntries(CHECKS.map((k) => [k, h('li.app-check')]));
      const list = h('ol.app-checks', { 'aria-live': 'polite' }, CHECKS.map((k) => rows[k]));
      const meterFill = h('span', { style: 'width:0%' });
      const meter = h('div.fh-progress.app-meter', { role: 'meter', 'aria-label': t('systemCheck.levelLabel'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, meterFill);
      const recLabel = h('span.app-record__label');
      const recButton = h('button.app-record', { type: 'button' }, icon('microphone', 'fh-icon--l'));
      const recStatus = h('div.app-hint.app-record__status', { 'aria-live': 'polite' });
      const continueBtn = h('button.fh-btn.fh-btn--emphasized', { type: 'button', disabled: true, onclick: () => ctx.flow.next() }, t('common.continue'));
      const doneStrip = h('div');

      const setRecordIdle = () => {
        recLabel.textContent = t(ptt ? 'systemCheck.recordLabelHold' : 'systemCheck.recordLabelIdle');
        recButton.setAttribute('aria-label', recLabel.textContent);
        recStatus.textContent = '';
      };

      function renderRow(k) {
        const c = checks[k];
        const row = clear(rows[k]);
        row.className = `app-check app-check--${c.state}`;
        let text = '';
        if (c.state === 'success' && k === 'stt') text = t('systemCheck.checks.stt.success', { text: c.text });
        else if (c.state !== 'failed') text = t(`systemCheck.checks.${k}.${c.state}`);
        const status = {
          pending: h('span.app-check__dot'),
          running: h('span.fh-busy', h('i'), h('i'), h('i')),
          success: icon('message-success', 'app-check__icon'),
          failed: icon('message-error', 'app-check__icon'),
        }[c.state];
        row.append(
          h('div.app-check__main',
            h('div.app-check__body',
              h('span.app-check__title', t(`systemCheck.checks.${k}.title`)),
              text && h('span.app-check__text', text)),
            h('span.app-check__status', status, h('span.app-sr-only', t(`systemCheck.status.${c.state}`)))),
        );
        if (c.state === 'failed') {
          const detail = h('div.app-check__detail', messageStrip('error', c.error.message));
          if (c.error.help) detail.append(...c.error.help.map((p) => h('p.app-hint', p)));
          if (c.retry) detail.append(h('div', h('button.fh-btn', { type: 'button', onclick: c.retry.run }, c.retry.label)));
          if (c.failures > cfg.retriesBeforeContact) detail.append(messageStrip('warning', t('systemCheck.contact')));
          row.append(detail);
        }
      }

      function set(k, state, extra = {}) {
        Object.assign(checks[k], { state, error: null, retry: null }, extra);
        if (state === 'failed') checks[k].failures++;
        renderRow(k);
        const allOk = CHECKS.every((x) => checks[x].state === 'success');
        const busy = CHECKS.some((x) => checks[x].state === 'running' && x !== 'mic');
        continueBtn.disabled = !allOk;
        recorder?.setEnabled(!allOk && !busy);
        clear(doneStrip);
        if (allOk) {
          doneStrip.append(messageStrip('success', t('systemCheck.allPassed')));
          ctx.session.update({ systemCheckPassedAt: new Date().toISOString() }, { immediate: true });
          logEvent('systemCheck.passed', { failures: Object.fromEntries(CHECKS.map((x) => [x, checks[x].failures])) });
          continueBtn.focus();
        }
      }

      const logCheck = (check, result, payload = {}) => logEvent('systemCheck.check', { check, result, attempt: checks[check].failures + 1, ...payload });

      function fail(k, key, { help, retry, payload } = {}) {
        logCheck(k, 'failed', { error: key, ...payload });
        set(k, 'failed', { error: { message: t(`systemCheck.errors.${key}`), help }, retry });
      }

      const resetFrom = (k) => {
        for (const x of CHECKS.slice(CHECKS.indexOf(k))) {
          if (checks[x].state !== 'failed') Object.assign(checks[x], { state: 'pending', error: null, retry: null });
          else checks[x].state = 'pending';
          renderRow(x);
        }
      };
      const recordAgain = { label: t('systemCheck.recordAgain'), run: () => { resetFrom('mic'); recorder.setEnabled(true); recButton.focus(); } };

      // ----- check 1: microphone -----
      function micFailure(err) {
        const kind = err instanceof MicError ? err.kind : 'unknown';
        const key = `mic${kind[0].toUpperCase()}${kind.slice(1)}`;
        const help = kind === 'denied' ? [t(`systemCheck.micHelp.${browserFamily()}`), t('systemCheck.micHelp.system')] : undefined;
        fail('mic', key, {
          help,
          payload: { kind },
          retry: {
            label: t('common.retry'),
            run: async () => {
              resetFrom('mic');
              try { await getMicStream(); recorder.setEnabled(true); recButton.focus(); } catch (e) { micFailure(e); }
            },
          },
        });
      }

      // ----- check 2: speech-to-text -----
      async function runStt() {
        set('stt', 'running');
        aborter = new AbortController();
        // A little longer than the server's own timeouts, so the server's error arrives first.
        const timeout = AbortSignal.timeout((ctx.config.stt.timeoutSeconds + 5) * 1000);
        const started = performance.now();
        try {
          const res = await api.transcribe(lastBlob.blob, { purpose: 'systemCheck', filename: `systemcheck.${lastBlob.ext}`, signal: AbortSignal.any([aborter.signal, timeout]) });
          if (destroyed) return;
          const text = (res.text ?? '').trim();
          // The recognized text itself is logged by the server (server.transcribe).
          const payload = { durationMs: Math.round(performance.now() - started), chars: text.length, mock: res.mock };
          if (!text) return fail('stt', 'sttEmpty', { retry: recordAgain, payload });
          logCheck('stt', 'success', payload);
          set('stt', 'success', { text });
          runLlm();
        } catch (e) {
          if (destroyed) return;
          const key = e.name === 'TimeoutError' || e.code === 'stt_timeout' ? 'timeout' : 'sttFailed';
          fail('stt', key, { payload: { code: e.code ?? e.name }, retry: { label: t('common.retry'), run: runStt } });
        }
      }

      // ----- check 3: LLM -----
      async function runLlm() {
        set('llm', 'running');
        aborter = new AbortController();
        const timeout = AbortSignal.timeout((ctx.config.ai.timeoutSeconds + 5) * 1000);
        const started = performance.now();
        try {
          const res = await api.health(AbortSignal.any([aborter.signal, timeout]));
          if (destroyed) return;
          if (!res.ok) throw new Error('not ok');
          logCheck('llm', 'success', { durationMs: Math.round(performance.now() - started), mock: res.mock });
          set('llm', 'success');
        } catch (e) {
          if (destroyed) return;
          const key = e.name === 'TimeoutError' || e.code === 'llm_timeout' ? 'timeout' : 'llmFailed';
          fail('llm', key, { payload: { code: e.code ?? e.name }, retry: { label: t('common.retry'), run: runLlm } });
        }
      }

      // ----- recorder -----
      recorder = createRecorder(ctx.config.interaction.recordingMode, {
        maxSeconds: cfg.maxRecordingSeconds,
        onStart() {
          resetFrom('mic');
          set('mic', 'running');
          recLabel.textContent = t(ptt ? 'systemCheck.recordLabelHold' : 'systemCheck.recordLabelRecording');
          recButton.setAttribute('aria-label', recLabel.textContent);
          recStatus.textContent = t('systemCheck.recordingStatus');
          logEvent('recording.start', { context: 'systemCheck', mode: recorder.mode });
        },
        onTick(seconds) {
          recStatus.textContent = t('systemCheck.recordingSeconds', { seconds: Math.floor(seconds) });
        },
        onLevel(level) {
          const pct = Math.round(level * 100);
          meterFill.style.width = `${pct}%`;
          meter.setAttribute('aria-valuenow', String(pct));
        },
        async onStop(rec) {
          setRecordIdle();
          logEvent('recording.stop', { context: 'systemCheck', durationMs: rec.durationMs, reason: rec.reason, peak: Math.round(rec.peak * 100) / 100, mimeType: rec.mimeType, bytes: rec.blob.size });
          if (destroyed || rec.reason === 'destroy') return;
          if (rec.tooShort) return fail('mic', 'tooShort', { retry: recordAgain });
          if (!rec.blob.size || rec.peak < SPEECH_LEVEL) return fail('mic', 'silent', { retry: recordAgain, payload: { peak: rec.peak, bytes: rec.blob.size } });
          const stream = await getMicStream().catch(() => null);
          logCheck('mic', 'success', { peak: Math.round(rec.peak * 100) / 100, device: micLabel(stream), mimeType: rec.mimeType });
          set('mic', 'success');
          lastBlob = rec;
          runStt();
        },
        onError(err) {
          setRecordIdle();
          micFailure(err);
        },
      });
      recorder.attach(recButton);
      setRecordIdle();
      CHECKS.forEach(renderRow);

      container.append(
        h('div.fh-page.app-page', h('div.fh-page__content.app-center',
          h('section.fh-card.app-card.app-card--wide',
            h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', t('systemCheck.title')))),
            h('div.fh-card__content.app-form',
              h('p.app-text', t('systemCheck.intro')),
              // First how recording works, then the sentence to read, then the button.
              h('p.app-text', t(ptt ? 'systemCheck.instructionPushToTalk' : 'systemCheck.instructionToggle')),
              h('div.app-sentence',
                h('div.app-sentence__label', t('systemCheck.sentenceLabel')),
                h('p.app-sentence__text', cfg.testSentence)),
              h('div.app-record-area', recButton, recLabel, meter, recStatus),
              list,
              doneStrip,
              h('div.app-actions', continueBtn))))),
      );
    },

    unmount() {
      destroyed = true;
      aborter?.abort();
      recorder?.destroy();
    },
  };
}
