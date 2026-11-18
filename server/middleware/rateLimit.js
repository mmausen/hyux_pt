// Simple in-memory sliding-window rate limiter. Good enough for one server process.
export function rateLimit({ windowMs, max, key, name }) {
  const hits = new Map(); // key -> timestamps
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const list = (hits.get(k) ?? []).filter((t) => t > now - windowMs);
    if (list.length >= max) {
      res.set('Retry-After', String(Math.ceil((list[0] + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', limit: name });
    }
    list.push(now);
    hits.set(k, list);
    next();
  };
}
