// Conversation review (flow.enabled.interview): a read-only view of the task and the full conversation
// of the round, with numbered turns and timestamps, so participant and interviewer can refer to them.
import { h } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';

const elapsed = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function create() {
  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      try { ctx.session.set(await api.getSession()); } catch { /* use what we have */ }
      const task = ctx.session.task(round);
      const startedAt = ctx.session.progress(round).taskStartedAt;
      const turns = (ctx.session.data.rounds?.[String(round)]?.turns ?? []).filter((x) => x.status === 'done');
      const assistant = ctx.config.ai.assistantName;
      const when = (iso) => (startedAt ? t('interview.time', { elapsed: elapsed(Date.parse(iso) - startedAt), clock: clock(iso) }) : clock(iso));

      const header = h('section.fh-card',
        h('div.fh-card__header', h('div.fh-card__heading',
          h('h1.fh-card__title.app-title', task.title),
          h('div.fh-card__subtitle', t('steps.interview')))),
        h('div.fh-card__content.app-form',
          h('p.app-text', t('interview.intro')),
          h('p.app-text.vc-task__text--strong', task.task)));

      const turnCard = (turn) => h('li.fh-card.app-review__turn',
        h('div.app-review__head',
          h('span.app-review__num', t('interview.turn', { n: turn.n })),
          h('span.app-hint', when(turn.sentAt))),
        h('div.app-review__grid',
          h('div',
            h('div.vc-instruction__label', t('interview.instruction')),
            h('p.vc-instruction__text', turn.transcript)),
          h('div',
            h('div.vc-instruction__label', t('interview.response', { assistant }), turn.respondedAt ? ` · ${when(turn.respondedAt)}` : ''),
            h('p.vc-response', turn.response))));

      const list = turns.length === 0
        ? h('p.app-text', t('interview.empty'))
        : h('ol.app-review__turns', turns.map(turnCard));

      const continueBtn = h('button.fh-btn.fh-btn--emphasized', { type: 'button', onclick: () => ctx.flow.next() }, t('common.continue'));

      container.append(h('div.fh-page.app-page', h('div.fh-page__content.app-review', header, list, h('div.app-actions', continueBtn))));
    },
    unmount() {},
  };
}
