// Task panel at the top of every mode's canvas. It starts collapsed to its title, so the work area has the
// room; Show Task opens the task and the situation (and materials, if a task has any) next to each other,
// Hide Task collapses them again. conceal hides everything but the title (briefing).
import { h, icon } from '../dom.js';
import { t } from '../strings.js';
import { logEvent } from '../logEvent.js';

export function createTaskPanel({ task, round, live, conceal = false }) {
  const materials = Array.isArray(task?.materials) ? task.materials : [];
  const details = h('div.vc-task__details',
    h('div.vc-task__block', h('div.vc-task__label', t('canvas.situationLabel')), h('p.vc-task__text', task?.situation ?? '')),
    materials.length ? h('div.vc-materials',
      materials.map((m) => h('section.vc-material', h('h3.vc-material__title', m.title), h('p.vc-material__body', m.body)))) : null);
  const body = conceal ? null : h('div.vc-task__body', { id: `vc-task-body-${round}`, hidden: true },
    h('div.vc-task__block', h('div.vc-task__label', t('canvas.taskLabel')), h('p.vc-task__text.vc-task__text--strong', task?.task ?? '')),
    details);
  const toggleBtn = conceal ? null : h('button.fh-btn.fh-btn--transparent', { type: 'button', 'aria-expanded': 'false', 'aria-controls': body.id },
    icon('slim-arrow-down'), h('span', t('canvas.showTask')));
  toggleBtn?.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.firstChild.dataset.icon = open ? 'slim-arrow-up' : 'slim-arrow-down';
    toggleBtn.lastChild.textContent = t(open ? 'canvas.hideTask' : 'canvas.showTask');
    if (live) logEvent(open ? 'taskPanel.opened' : 'taskPanel.closed', {});
  });

  return h('section.vc-task', { 'aria-label': t('canvas.taskLabel'), dataset: { region: 'task' } },
    h('div.vc-task__head', h('h1.vc-task__title', task?.title ?? ''), toggleBtn),
    body);
}
