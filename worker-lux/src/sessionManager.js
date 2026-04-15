const { loadSessions, saveSessions } = require("./sessionStore");
const logger = require("./logger");

const sessions = new Map();
const stored = loadSessions();

for (const s of stored) {
  if (s?.email) sessions.set(s.email, s);
}

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 25 * 60 * 1000);

function persist() {
  saveSessions(Array.from(sessions.values()));
}

function getSession(email) {
  if (!email) return null;
  const session = sessions.get(email);
  if (!session) return null;

  if (!session.cookies || typeof session.cookies !== "string") {
    sessions.delete(email);
    persist();
    logger.warn("session removed because cookies are missing", { email });
    return null;
  }

  const createdAtMs = Number(session.created_at_ms || 0);
  const age = Date.now() - createdAtMs;

  if (!createdAtMs || age > SESSION_TTL_MS) {
    sessions.delete(email);
    persist();
    logger.info("session expired by ttl", { email, age_ms: age });
    return null;
  }

  session.last_used_at = new Date().toISOString();
  sessions.set(email, session);
  persist();
  return session;
}

function saveSession(email, data = {}) {
  if (!email) throw new Error("session_email_required");

  const previous = sessions.get(email);
  const session = {
    email,
    cookies: String(data.cookies || "").trim(),
    created_at: new Date().toISOString(),
    created_at_ms: Date.now(),
    last_used_at: new Date().toISOString(),
    login_count: Number(previous?.login_count || 0) + 1,
    login_method: data.login_method || "unknown",
  };

  if (!session.cookies) throw new Error("session_cookies_missing");

  sessions.set(email, session);
  persist();

  logger.info("session saved", { email, login_count: session.login_count, login_method: session.login_method, cookie_present: true });
  return session;
}

function invalidateSession(email, reason = "manual") {
  if (!email) return;
  const existed = sessions.has(email);
  sessions.delete(email);
  persist();
  logger.warn("session invalidated", { email, reason, existed });
}

function listSessions() {
  return Array.from(sessions.values()).map((session) => ({
    email: session.email,
    created_at: session.created_at,
    last_used_at: session.last_used_at,
    login_count: session.login_count,
    login_method: session.login_method,
  }));
}

module.exports = { getSession, saveSession, invalidateSession, listSessions };
