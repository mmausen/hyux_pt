// Task panel at the top of every mode's canvas. The task is always visible. The situation (and materials,
// if a task has any) is read in the briefing before the timer starts, so here it starts collapsed behind
// Show Situation to leave room for the work area. conceal hides everything but the title (briefing).
import { h, icon } from '../dom.js';
import { t } from '../strings.js';
import { logEvent } from '../logEvent.js';

export function createTaskPanel({ task, round, live, conceal = false }) {
  const materials = Array.isArray(task?.materials) ? task.materials : [];
  const details = h('div.vc-task__details', { id: `vc-details-${round}`, hidden: true },
    h('div.vc-task__block', h('div.vc-task__label', t('canvas.situationLabel')), h('p.vc-task__text', task?.situation ?? '')),
    materials.length ? h('div.vc-materials',
      materials.map((m) => h('section.vc-material', h('h3.vc-material__title', m.title), h('p.vc-material__body', m.body)))) : null);
  const detailsBtn = conceal ? null : h('button.fh-btn.fh-btn--transparent', { type: 'button', 'aria-expanded': 'false', 'aria-controls': details.id },
    icon('slim-arrow-down'), h('span', t('canvas.showSituation')));
  detailsBtn?.addEventListener('click', () => {
    const open = details.hidden;
    details.hidden = !open;
    detailsBtn.setAttribute('aria-expanded', String(open));
    detailsBtn.firstChild.dataset.icon = open ? 'slim-arrow-up' : 'slim-arrow-down';
    detailsBtn.lastChild.textContent = t(open ? 'canvas.hideSituation' : 'canvas.showSituation');
    if (live) logEvent(open ? 'situation.opened' : 'situation.closed', {});
  });

  return h('section.vc-task', { 'aria-label': t('canvas.taskLabel'), dataset: { region: 'task' } },
    h('div.vc-task__head', h('h1.vc-task__title', task?.title ?? ''), detailsBtn),
    conceal ? null : h('div.vc-task__body',
      h('div.vc-task__block', h('div.vc-task__label', t('canvas.taskLabel')), h('p.vc-task__text.vc-task__text--strong', task?.task ?? '')),
      details));
}
