// Controls bar at the bottom of every mode's canvas: record button with its label, status and level
// meter; send; finish; and the slot the task screen puts the timer bar into.
//
//   const c = createControls(ctx, { showFinish, sendLabelKey });
//   c.el, c.recButton, c.sendBtn, c.finishBtn, c.timerSlot
//   c.recordingStarted(), c.recordingTick(s), c.recordingLevel(l), c.recordingStopped(rec), c.setSendLabel(key, vars)
import { h, icon } from '../dom.js';
import { t } from '../strings.js';

export function createControls(ctx, { showFinish = true, sendLabelKey = 'canvas.send' } = {}) {
  const { config } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  const meterFill = h('span', { style: 'width:0%' });
  const meter = h('div.fh-progress.vc-meter', { 'aria-hidden': 'true' }, meterFill);
  const recLabel = h('span.vc-rec__label');
  const recStatus = h('span.vc-rec__status', { 'aria-live': 'polite' });
  const recButton = h('button.app-record.vc-rec__button', { type: 'button', dataset: { region: 'record' } }, icon('microphone', 'fh-icon--l'));
  const sendText = h('span', t(sendLabelKey));
  const sendBtn = h('button.fh-btn.fh-btn--emphasized.vc-send', { type: 'button', dataset: { region: 'send' } }, icon('ai'), sendText);
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });

  function idle() {
    recLabel.textContent = t(ptt ? 'canvas.recordHold' : 'canvas.recordStart');
    recButton.setAttribute('aria-label', ptt ? `${recLabel.textContent} (${t('canvas.recordHintPushToTalk')})` : recLabel.textContent);
    recStatus.textContent = ptt ? t('canvas.recordHintPushToTalk') : '';
    meterFill.style.width = '0%';
  }
  idle();

  const el = h('footer.vc-controls',
    h('div.vc-controls__row',
      h('div.vc-controls__side'),
      h('div.vc-controls__main',
        h('div.vc-rec', recButton, h('div.vc-rec__text', recLabel, recStatus, meter)),
        sendBtn),
      h('div.vc-controls__side.vc-controls__side--end', finishBtn)),
    timerSlot);

  return {
    el, recButton, sendBtn, finishBtn, timerSlot,
    recordingStarted() {
      recLabel.textContent = t(ptt ? 'canvas.recordHold' : 'canvas.recordStop');
      recStatus.textContent = t('canvas.recordingStatus', { seconds: 0 });
    },
    recordingTick(s) { recStatus.textContent = t('canvas.recordingStatus', { seconds: Math.floor(s) }); },
    recordingLevel(level) { meterFill.style.width = `${Math.round(level * 100)}%`; },
    recordingStopped(rec) {
      idle();
      if (rec?.reason === 'maxLength') recStatus.textContent = t('canvas.recordingMax', { seconds: config.interaction.maxRecordingSeconds });
    },
    setSendLabel(key, vars) { sendText.textContent = t(key, vars); },
  };
}
