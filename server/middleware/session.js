// Resolves the study session from the X-Session-Id header and attaches it as req.study.
export function requireSession(store) {
  return (req, res, next) => {
    const session = store.get(req.get('X-Session-Id'));
    if (!session) return res.status(401).json({ error: 'no_session' });
    req.study = session;
    next();
  };
}

// True when this request should use canned responses instead of OpenAI. Only possible in dev mode.
export function useMock(req, env, kind) {
  return env.devMode && Boolean(req.study?.dev?.mock?.[kind]);
}
