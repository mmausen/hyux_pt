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
      // A mode without a tour (no tutorialSteps) skips the tutorial, practice turn included.
      if (!mode.tutorialSteps) {
        logEvent('tutorial.skipped', { mode: mode.name, reason: 'noTutorial' });
        return ctx.flow.next();
      }
      const host = h('div.app-canvas-host');
      container.append(host);

      const startPractice = (resumed = false) => {
        canvas?.destroy();
        clear(host);
        session.update({ tutorial: { ...(session.state.tutorial ?? {}), practice: true } });
        if (!session.progress(PRACTICE_ROUND).taskStartedAt) session.updateProgress(PRACTICE_ROUND, { taskStartedAt: Date.now() }, { immediate: true });
        logEvent('tutorial.practiceStarted', { resumed });
        // Continue sits at the bottom right, where Finish Task is in a task. It becomes available, with a
        // light pulse, once the participant has made their first recording (transcribed).
        // Same size as the send button (vc-send).
        const continueBtn = h('button.fh-btn.fh-btn--emphasized.vc-send.app-practice__continue', { type: 'button', disabled: true, onclick: () => {
          logEvent('tutorial.completed', { practice: true });
          ctx.flow.next();
        } }, t('tutorial.practice.continue'));
        const unlock = (reason) => {
          if (!continueBtn.disabled) return;
          continueBtn.disabled = false;
          continueBtn.classList.add('is-pulsing');
          logEvent('tutorial.practiceUnlocked', { reason });
        };
        // A mode can bring its own practice task and intro (tutorial.practice.<mode>).
        const practice = raw(`tutorial.practice.${mode.name}`) ?? {};
        const banner = h('div.app-practice', messageStrip('information', practice.intro ?? t('tutorial.practice.intro')));
        canvas = mode.createCanvas(ctx, {
          round: PRACTICE_ROUND,
          task: practice.task ?? raw('tutorial.practice.task'),
          live: true,
          showFinish: false,
          onRecorded: () => unlock('recording'),
          onTurn(turn) {
            logEvent('tutorial.practiceTurn', { turn: turn.n });
            clear(banner).append(messageStrip('success', t('tutorial.practice.done')));
            unlock('turn');
          },
        });
        canvas.timerSlot.hidden = true;
        canvas.noticeSlot.append(banner);
        canvas.regions.finish.parentElement.append(continueBtn);
        host.append(canvas.el);
        // A recording or practice turn from before a reload counts.
        const practiceData = session.data.rounds?.[String(PRACTICE_ROUND)] ?? {};
        if ((practiceData.turns ?? []).some((x) => x.status === 'done' && x.kind !== 'scaffold')) {
          clear(banner).append(messageStrip('success', t('tutorial.practice.done')));
          unlock('resumed');
        } else if ((practiceData.intents ?? []).length || (session.progress(PRACTICE_ROUND).draft ?? []).length
          || (practiceData.customer?.notes ?? []).length || (practiceData.customer?.reactions ?? []).some((r) => r.responses?.length)) unlock('resumed');
      };

      // Resume straight into the practice turn after a reload.
      if (config.tutorial.practiceTurn && session.state.tutorial?.practice) return startPractice(true);

      const sample = raw('tutorial.sample');
      const now = new Date().toISOString();
      canvas = mode.createCanvas(ctx, {
        round: PRACTICE_ROUND,
        task: sample.task,
        live: false,
        sample: { turns: sample.turns.map((x) => ({ ...x, sentAt: now, respondedAt: now, status: 'done' })), draft: sample.draft, intents: sample.intents ?? [], scaffold: sample.scaffold ?? null, customer: sample.customer ?? null },
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
