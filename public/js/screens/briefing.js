// Briefing: an overlay over the (not yet live) canvas with the task's parameters. The timer starts when
// the participant confirms. The task text stays hidden until then, so reading time counts toward the task.
import { h } from '../core/dom.js';
import { t } from '../core/strings.js';
import { openDialog } from '../core/dialog.js';
import { logEvent } from '../core/logEvent.js';

export default function create() {
  let canvas = null;
  let dialog = null;

  return {
    mount(container, ctx) {
      const { round } = ctx.step;
      const task = ctx.session.task(round);
      const timer = ctx.config.timer;

      // Already confirmed (e.g. dev jump back): go straight on.
      if (ctx.session.progress(round).taskStartedAt) return ctx.flow.next();

      canvas = ctx.mode.createCanvas(ctx, { round, task, live: false, conceal: true });
      container.append(h('div.app-canvas-host', canvas.el));

      const timerText = {
        hard: t('briefing.timerHard'),
        soft: t('briefing.timerSoft'),
        grace: t('briefing.timerGrace', { minutes: timer.graceMinutes }),
      }[timer.mode];

      const start = async () => {
        await ctx.session.updateProgress(round, { taskId: task.id, taskStartedAt: Date.now() }, { immediate: true });
        logEvent('task.started', { title: task.title, timeLimitMinutes: task.timeLimitMinutes, timerMode: timer.mode });
        dialog.close();
        dialog = null;
        ctx.flow.next();
      };

      dialog = openDialog({
        title: task.title,
        className: 'app-briefing',
        content: h('div.app-form',
          task.briefing ? h('p.app-text', task.briefing) : null,
          h('div.app-briefing__limit',
            h('span.fh-attr__label', t('briefing.timeLimit')),
            h('span.fh-attr__value.fh-attr__value--large', t('briefing.minutes', { minutes: task.timeLimitMinutes }))),
          h('p.app-text', timerText),
          h('p.app-hint', t('briefing.timerStarts'))),
        actions: [{ label: t('briefing.start'), emphasized: true, onClick: start }],
      });
    },

    unmount() {
      dialog?.close();
      canvas?.destroy();
    },
  };
}
