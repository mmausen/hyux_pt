// Generative UI of the intents mode (branch gen-ui): components the structuring step chose for the plan
// and filled (session.rounds[round].components, see server/routes/intents.js). The client brings the
// catalog; the model decides which component appears and what it holds.
//
//   renderComponent(component, { intents, locked, accentOf, groupOf, onChange }) → element
//   onChange(next): the participant changed the component (next is the whole component)
// Focusable elements carry data-fkey, so the canvas can put the focus back after it renders anew.
//
// arguments: the arguments of the plan in a grid. Columns are the order in which the text makes them,
// the two rows their level (main, supporting). An argument moves by dragging it to another cell, by its
// buttons, or with the arrow keys (left and right: order; up and down: level).
// tones: the passages of the text in order, each with the tones on offer; one is chosen per passage.
import { h } from '../../core/dom.js';
import { t } from '../../core/strings.js';

const LEVELS = ['main', 'supporting'];

export function renderComponent(c, ctx) {
  if (c.type === 'arguments') return argumentsComponent(c, ctx);
  if (c.type === 'tones') return tonesComponent(c, ctx);
  return null;
}

export const componentTitle = (c) => c.title || t(c.type === 'arguments' ? 'gen.arguments' : 'gen.tones');

function argumentsComponent(c, { intents, locked, accentOf, groupOf, onChange }) {
  const byId = new Map(intents.map((x) => [x.id, x]));
  const items = c.items.filter((x) => byId.has(x.id));
  const n = items.length;
  const move = (from, to, level) => {
    const next = items.map((x) => ({ ...x }));
    const [item] = next.splice(from, 1);
    item.level = level ?? item.level;
    next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
    if (JSON.stringify(next) !== JSON.stringify(items)) onChange({ ...c, items: next });
  };
  const levelName = (level) => t(`gen.${level}`);
  const grid = h('div.gc-args', { style: `--gc-n:${n}`, role: 'group', 'aria-label': componentTitle(c) });
  // Header row: the position numbers.
  grid.append(h('span.gc-args__corner'), ...items.map((_, i) => h('span.gc-args__pos', String(i + 1))));
  let dragging = null; // index of the argument being dragged
  for (const level of LEVELS) {
    grid.append(h('span.gc-args__level', levelName(level)));
    items.forEach((item, i) => {
      const cell = h('div.gc-cell', { dataset: { level, col: String(i) } });
      cell.addEventListener('dragover', (e) => { if (dragging !== null && !locked) { e.preventDefault(); cell.classList.add('is-over'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('is-over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('is-over');
        if (dragging !== null) move(dragging, i, level);
        dragging = null;
      });
      if (item.level === level) {
        const intent = byId.get(item.id);
        const other = LEVELS.find((l) => l !== level);
        const earlier = h('button.fh-btn.fh-btn--transparent.gc-arg__btn', { type: 'button', disabled: locked || i === 0, title: t('gen.moveEarlier'), 'aria-label': t('gen.moveEarlier'), dataset: { fkey: `${item.id}:earlier` } }, '←');
        const later = h('button.fh-btn.fh-btn--transparent.gc-arg__btn', { type: 'button', disabled: locked || i === n - 1, title: t('gen.moveLater'), 'aria-label': t('gen.moveLater'), dataset: { fkey: `${item.id}:later` } }, '→');
        const switchLevel = h('button.fh-btn.fh-btn--transparent.gc-arg__level', { type: 'button', disabled: locked, dataset: { fkey: `${item.id}:level` } }, t('gen.makeLevel', { level: levelName(other) }));
        earlier.addEventListener('click', () => move(i, i - 1));
        later.addEventListener('click', () => move(i, i + 1));
        switchLevel.addEventListener('click', () => move(i, i, other));
        const card = h('div.gc-arg', {
          draggable: locked ? 'false' : 'true', tabindex: '0', dataset: { accent: String(accentOf(groupOf(intent))), id: item.id, fkey: item.id },
          'aria-label': t('gen.argumentLabel', { text: intent.text, n: i + 1, level: levelName(level) }),
        },
        h('span.gc-arg__text', intent.text),
        intent.nuance ? h('span.ic-card__nuance', intent.nuance) : null,
        h('span.gc-arg__tools', earlier, later, switchLevel));
        card.addEventListener('dragstart', (e) => { dragging = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); card.classList.add('is-dragging'); });
        card.addEventListener('dragend', () => { dragging = null; card.classList.remove('is-dragging'); });
        card.addEventListener('keydown', (e) => {
          if (locked || e.target !== card) return;
          const keys = { ArrowLeft: () => move(i, i - 1), ArrowRight: () => move(i, i + 1), ArrowUp: () => move(i, i, 'main'), ArrowDown: () => move(i, i, 'supporting') };
          if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
        });
        cell.append(card);
      } else cell.classList.add('is-empty');
      grid.append(cell);
    });
  }
  return h('div.gc', h('p.gc__hint', t('gen.argumentsHint')), grid);
}

function tonesComponent(c, { locked, onChange }) {
  const row = h('div.gc-tones', { role: 'group', 'aria-label': componentTitle(c) });
  c.passages.forEach((p, i) => {
    const options = h('div.gc-tone__options', { role: 'radiogroup', 'aria-label': t('gen.toneFor', { name: p.name }) });
    for (const tone of c.options) {
      const on = tone === p.tone;
      const b = h('button.gc-tone__option', { type: 'button', role: 'radio', 'aria-checked': String(on), disabled: locked, class: on ? 'is-on' : '', dataset: { fkey: `${i}:${tone}` } }, tone);
      b.addEventListener('click', () => {
        if (on) return;
        onChange({ ...c, passages: c.passages.map((x, j) => (j === i ? { ...x, tone } : x)) });
      });
      options.append(b);
    }
    row.append(h('section.gc-tone', h('h4.gc-tone__name', h('span.gc-args__pos', String(i + 1)), p.name), options));
  });
  return h('div.gc', h('p.gc__hint', t('gen.tonesHint')), row);
}
