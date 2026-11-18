// Word diff (also in the highlight and slider modes): the ranges of `next` that are new compared
// to `prev` ([{ start, end }]); white space alone is never a change.
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
