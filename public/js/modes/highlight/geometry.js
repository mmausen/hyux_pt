// Geometry and text helpers of the highlight mode: offsets ↔ DOM ranges, the frame around a highlighted
// passage, and a word diff that shows which parts of the draft an edit changed.

// Character offset of (node, offset) inside root (text content order).
export function offsetOf(root, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

// DOM range for the character offsets [start, end) inside root.
export function rangeOf(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length;
    if (!startSet && start <= pos + len) { range.setStart(n, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { range.setEnd(n, end - pos); return range; }
    pos += len;
  }
  return startSet ? range : null;
}

// Expands [start, end) to whole words and trims surrounding white space.
export function snapToWords(text, start, end) {
  const word = /[\p{L}\p{N}_'’-]/u;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start >= end) return null;
  while (start > 0 && word.test(text[start - 1]) && word.test(text[start])) start--;
  while (end < text.length && word.test(text[end]) && word.test(text[end - 1])) end++;
  return { start, end };
}

// The lines of a range, relative to `box` (an element's bounding rect): [{ l, r, t, b }], top to bottom.
export function linesOf(range, box) {
  const rects = [...range.getClientRects()].filter((x) => x.width >= 1 && x.height >= 1);
  const lines = [];
  for (const x of rects) {
    const rect = { l: x.left - box.left, r: x.right - box.left, t: x.top - box.top, b: x.bottom - box.top };
    const same = lines.find((y) => Math.abs(y.t - rect.t) < 3 || (rect.t < y.b - 2 && rect.b > y.t + 2));
    if (same) Object.assign(same, { l: Math.min(same.l, rect.l), r: Math.max(same.r, rect.r), t: Math.min(same.t, rect.t), b: Math.max(same.b, rect.b) });
    else lines.push(rect);
  }
  return lines.sort((a, b) => a.t - b.t);
}

// Splits the lines into blocks of lines that touch horizontally, padded and joined vertically, so each
// block can be drawn as one outline. A selection from the end of one line to the start of the next gives
// two blocks instead of a shape with a thin bridge.
export function blocksOf(lines, { padX = 6, padY = 3 } = {}) {
  const padded = lines.map((x) => ({ l: x.l - padX, r: x.r + padX, t: x.t - padY, b: x.b + padY }));
  const blocks = [];
  let cur = null;
  for (const line of padded) {
    const prev = cur?.at(-1);
    if (prev && Math.min(prev.r, line.r) - Math.max(prev.l, line.l) > 24) {
      const mid = (prev.b + line.t) / 2; // no gap between lines
      prev.b = mid;
      line.t = mid;
      cur.push(line);
    } else {
      cur = [line];
      blocks.push(cur);
    }
  }
  return blocks;
}

// Outline of a block of lines (each { l, r, t, b }, joined vertically) as a closed polygon, clockwise.
function polygonOf(block) {
  const pts = [];
  block.forEach((x, i) => {
    if (i === 0) pts.push([x.l, x.t]);
    pts.push([x.r, x.t]);
    pts.push([x.r, x.b]);
  });
  for (let i = block.length - 1; i >= 0; i--) {
    const x = block[i];
    pts.push([x.l, x.b]);
    pts.push([x.l, x.t]);
  }
  // Drop repeated and collinear points (a step of zero width).
  const out = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - p[0]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5) continue;
    out.push(p);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out.at(-1)[0]) < 0.5 && Math.abs(out[0][1] - out.at(-1)[1]) < 0.5) out.pop();
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length];
    const p = out[i];
    const b = out[(i + 1) % out.length];
    const collinear = (Math.abs(a[0] - p[0]) < 0.5 && Math.abs(p[0] - b[0]) < 0.5) || (Math.abs(a[1] - p[1]) < 0.5 && Math.abs(p[1] - b[1]) < 0.5);
    if (!collinear) clean.push(p);
  }
  return clean;
}

// SVG path of a polygon with rounded corners (circular arcs, radius limited by the edge lengths).
function roundedPath(pts, radius) {
  const K = 0.5523; // cubic Bézier approximation of a quarter circle
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const p = pts[i];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, la / 2, lb / 2);
    const ua = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
    const ub = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const p1 = [p[0] + ua[0] * r, p[1] + ua[1] * r];
    const p2 = [p[0] + ub[0] * r, p[1] + ub[1] * r];
    const c1 = [p1[0] - ua[0] * r * K, p1[1] - ua[1] * r * K];
    const c2 = [p2[0] - ub[0] * r * K, p2[1] - ub[1] * r * K];
    const f = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    d += `${i === 0 ? 'M' : 'L'}${f(p1)} C${f(c1)} ${f(c2)} ${f(p2)} `;
  }
  return `${d}Z`;
}

// Path data for the frame: a one-line block is a pill (half circles at both ends), a block of several
// lines a box with rounded corners that follows the text.
export function framePath(blocks, { radius = 10 } = {}) {
  return blocks.map((block) => {
    const pts = polygonOf(block);
    if (pts.length < 3) return '';
    const r = block.length === 1 ? (block[0].b - block[0].t) / 2 : radius;
    return roundedPath(pts, r);
  }).join(' ');
}

// Word diff: the ranges of `next` that are new compared to `prev` ([{ start, end }], white space alone
// is never a change).
export function changedRanges(prev, next) {
  const tok = (s) => s.match(/[\p{L}\p{N}_'’]+|\s+|[^\s\p{L}\p{N}_'’]/gu) ?? [];
  const a = tok(prev);
  const b = tok(next);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const changed = new Array(bm.length).fill(true);
  if (am.length && bm.length && am.length * bm.length <= 4_000_000) {
    // LCS: tokens of b in the common subsequence are unchanged.
    const w = bm.length + 1;
    const dp = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) {
        dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    for (let i = 0, j = 0; i < am.length && j < bm.length;) {
      if (am[i] === bm[j]) { changed[j] = false; i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }
  // Offsets in next; join changed tokens separated only by white space.
  let pos = b.slice(0, pre).join('').length;
  const ranges = [];
  bm.forEach((t, j) => {
    const isSpace = /^\s+$/.test(t);
    if (changed[j] && !isSpace) {
      const last = ranges.at(-1);
      const gap = last ? next.slice(last.end, pos) : null;
      if (last && /^\s*$/.test(gap)) last.end = pos + t.length;
      else ranges.push({ start: pos, end: pos + t.length });
    }
    pos += t.length;
  });
  return ranges;
}
