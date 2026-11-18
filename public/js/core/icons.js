// Icon loader for the design system: fills every [data-icon] with inline SVG path data from
// @ui5/webcomponents-icons (SAP-icons-v5, Horizon style), pinned to the version the design system uses.
// Screens add DOM dynamically, so a MutationObserver hydrates new icons automatically.
const VERSION = '2.9.0';
const cache = new Map();

function load(name) {
  if (!cache.has(name)) {
    cache.set(name, import(`https://cdn.jsdelivr.net/npm/@ui5/webcomponents-icons@${VERSION}/dist/v5/${name}.js/+esm`)
      .then((m) => {
        const d = Array.isArray(m.pathData) ? m.pathData : [m.pathData];
        return `<svg viewBox="0 0 512 512" aria-hidden="true">${d.map((p) => `<path d="${p}"/>`).join('')}</svg>`;
      })
      .catch(() => '')); // icon unavailable: the empty 1rem box keeps the layout
  }
  return cache.get(name);
}

async function hydrate(el) {
  const name = el.dataset.icon;
  if (!/^[a-z0-9-]+$/.test(name) || el.dataset.iconLoaded === name) return;
  el.dataset.iconLoaded = name;
  el.innerHTML = await load(name);
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(hydrate);
}

export function watchIcons(root = document.body) {
  hydrateIcons(root);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') { hydrate(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[data-icon]')) hydrate(n);
        hydrateIcons(n);
      }
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-icon'] });
}
