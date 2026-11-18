// Tutorial: a coach-mark tour over the real canvas in a non-live state, then (tutorial.practiceTurn)
// one practice instruction with real recording and a real AI response. The steps come from the
// interaction mode (tutorialSteps), so another mode brings its own tour. The sample content
// (tutorial.sample) holds what every mode needs; a mode ignores what it does not use.
import { h, clear, messageStrip } from '../core/dom.js';
import { t, raw } from '../core/strings.js';
import { logEvent } from '../core/logEvent.js';
import { runCoachmarks } from '../core/coachmarks.js';
import { createTimerBar } from '../core/timer/timerBar.js';

const PRACTICE_ROUND = 0; // /api/chat stores the practice turn apart from the task rounds

export default function create() {
  let canvas = null;
  let tour = null;
  let gone = false;

  return {
    async mount(container, ctx) {
      const { config, session } = ctx;
      const mode = await ctx.getMode();
      if (gone) return;
      const host = h('div.app-canvas-host');
      container.append(host);

      const startPractice = (resumed = false) => {
        canvas?.destroy();
        clear(host);
        session.update({ tutorial: { ...(session.state.tutorial ?? {}), practice: true } });
        if (!session.progress(PRACTICE_ROUND).taskStartedAt) session.updateProgress(PRACTICE_ROUND, { taskStartedAt: Date.now() }, { immediate: true });
        logEvent('tutorial.practiceStarted', { resumed });
        const continueBtn = h('button.fh-btn.fh-btn--emphasized', { type: 'button', disabled: true, onclick: () => {
          logEvent('tutorial.completed', { practice: true });
          ctx.flow.next();
        } }, t('tutorial.practice.continue'));
        const banner = h('div.app-practice', messageStrip('information', t('tutorial.practice.intro')), continueBtn);
        canvas = mode.createCanvas(ctx, {
          round: PRACTICE_ROUND,
          task: raw('tutorial.practice.task'),
          live: true,
          showFinish: false,
          onTurn(turn) {
            logEvent('tutorial.practiceTurn', { turn: turn.n });
            clear(banner).append(messageStrip('success', t('tutorial.practice.done')), continueBtn);
            continueBtn.disabled = false;
            continueBtn.focus();
          },
        });
        canvas.timerSlot.hidden = true;
        canvas.noticeSlot.append(banner);
        host.append(canvas.el);
        // A practice turn that already finished before a reload counts.
        if ((session.data.rounds?.[String(PRACTICE_ROUND)]?.turns ?? []).some((x) => x.status === 'done')) {
          clear(banner).append(messageStrip('success', t('tutorial.practice.done')), continueBtn);
          continueBtn.disabled = false;
        }
      };

      // Resume straight into the practice turn after a reload.
      if (config.tutorial.practiceTurn && session.state.tutorial?.practice) return startPractice(true);

      const sample = raw('tutorial.sample');
      const now = new Date().toISOString();
      canvas = mode.createCanvas(ctx, {
        round: PRACTICE_ROUND,
        task: sample.task,
        live: false,
        sample: { turns: sample.turns.map((x) => ({ ...x, sentAt: now, respondedAt: now, status: 'done' })), draft: sample.draft, intents: sample.intents ?? [] },
      });
      host.append(canvas.el);

      // Static timer so the timer step has something to point at.
      const bar = createTimerBar();
      canvas.timerSlot.append(bar.el);
      bar.update({ elapsedMs: 98_000, remainingMs: 262_000, limitMs: 360_000, phase: 'running', phaseRemainingMs: 262_000, graceMs: 0 });

      const steps = mode.tutorialSteps({ recordingMode: config.interaction.recordingMode })
        .map((s) => ({ ...s, title: t(s.titleKey), text: t(s.textKey) }));
      logEvent('tutorial.started', { steps: steps.length });

      tour = runCoachmarks({
        steps,
        resolveTarget: (s) => canvas.getRegion(s.region),
        labels: {
          back: t('tutorial.back'),
          next: t('tutorial.next'),
          last: config.tutorial.practiceTurn ? t('tutorial.startPractice') : t('tutorial.finish'),
          progress: (step, total) => t('tutorial.progress', { step, total }),
        },
        onStep: (i, s) => logEvent('tutorial.step', { index: i, region: s.region }),
      });
      await tour.done;
      tour.destroy();
      tour = null;
      if (gone) return;
      logEvent('tutorial.tourCompleted', {});
      if (config.tutorial.practiceTurn) startPractice();
      else {
        logEvent('tutorial.completed', { practice: false });
        ctx.flow.next();
      }
    },

    unmount() {
      gone = true;
      tour?.destroy();
      canvas?.destroy();
    },
  };
}
