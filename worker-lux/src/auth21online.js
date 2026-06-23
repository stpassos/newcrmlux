const logger = require("./logger");
const {
  getSession,
  saveSession,
  invalidateSession,
} = require("./sessionManager");
const { resolveLoginActionId } = require("./loginActionResolver");

// Fallback action ID — used if dynamic resolution fails
const LOGIN_ACTION_ID_FALLBACK = "7ec4e77929af146ecef2369bc094f4fbdbe9ab11";

// In-memory cache for the resolved action ID (2 hour TTL)
let _cachedActionId = null;
let _cacheExpiresAt = 0;
const ACTION_ID_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

async function resolveActionId(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedActionId && now < _cacheExpiresAt) {
    return _cachedActionId;
  }
  try {
    const res = await fetch("https://21online.app/login", {
      headers: { "User-Agent": "crm21-worker" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const resolved = resolveLoginActionId(html);
    if (resolved) {
      _cachedActionId = resolved;
      _cacheExpiresAt = now + ACTION_ID_CACHE_TTL_MS;
      if (resolved !== LOGIN_ACTION_ID_FALLBACK) {
        logger.info("21online login action ID updated", { action_id: resolved });
      }
      return resolved;
    }
  } catch (err) {
    logger.warn("21online action ID resolution failed, using fallback", { error: err.message });
  }
  return LOGIN_ACTION_ID_FALLBACK;
}

function invalidateActionIdCache() {
  _cachedActionId = null;
  _cacheExpiresAt = 0;
}

const ROUTER_TREE = [
  "",
  {
    children: [
      "(auth)",
      {
        children: [
          "login",
          {
            children: ["__PAGE__", {}],
          },
        ],
      },
    ],
  },
  null,
  null,
  true,
];

function parseServerActionText(bodyText) {
  const text = String(bodyText || "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const result = { raw: text, validationErrors: null, serverError: null };

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const payload = line.slice(idx + 1).trim();
    if (!payload.startsWith("{")) continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.validationErrors) result.validationErrors = obj.validationErrors;
      if (obj.serverError) result.serverError = obj.serverError;
    } catch (_) {}
  }

  return result;
}

function extractCookieHeader(res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];

  if (Array.isArray(setCookies) && setCookies.length > 0) {
    return setCookies
      .map((value) => String(value).split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }

  const single = res.headers.get("set-cookie");
  if (!single) return "";

  return String(single)
    .split(/,(?=[^;]+?=)/g)
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function attemptLogin(email, password, actionId) {
  const args = [{ email, password, redirectUrl: "/dashboard" }];

  const res = await fetch("https://21online.app/login", {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
      "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(ROUTER_TREE)),
      Origin: "https://21online.app",
      Referer: "https://21online.app/login",
      "User-Agent": "crm21-worker",
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });

  const text = await res.text();
  const parsed = parseServerActionText(text);
  const cookies = extractCookieHeader(res);

  logger.info("21online login response", {
    email,
    status: res.status,
    action_id: actionId,
    has_validation_errors: Boolean(parsed.validationErrors),
    has_server_error: Boolean(parsed.serverError),
    cookie_present: Boolean(cookies),
  });

  return { parsed, cookies };
}

async function login21online(email, password, options = {}) {
  if (!email || !password) throw new Error("missing_credentials");

  const forceRefresh = Boolean(options.forceRefresh);

  if (!forceRefresh) {
    const existing = getSession(email);
    if (existing) {
      logger.debug("21online session reused", { email });
      return existing;
    }
  } else {
    invalidateSession(email, "force_refresh");
  }

  logger.info("21online login attempt", { email, force_refresh: forceRefresh });

  try {
    // Resolve the current Next.js server action ID (cached, 2h TTL)
    const actionId = await resolveActionId();
    const { parsed, cookies } = await attemptLogin(email, password, actionId);

    if (parsed.validationErrors) {
      const emailError = parsed.validationErrors.email?.[0];
      const passwordError = parsed.validationErrors.password?.[0];
      throw new Error(emailError || passwordError || "VALIDATION_ERROR");
    }

    if (parsed.serverError) throw new Error(parsed.serverError);

    // If no cookies were returned, the action ID may be stale — retry once with a fresh resolve
    if (!cookies) {
      logger.warn("21online login: no cookies returned, refreshing action ID and retrying", { email, action_id_used: actionId });
      invalidateActionIdCache();
      const freshActionId = await resolveActionId(true);

      if (freshActionId !== actionId) {
        const retry = await attemptLogin(email, password, freshActionId);
        if (retry.parsed.validationErrors) {
          const emailError = retry.parsed.validationErrors.email?.[0];
          const passwordError = retry.parsed.validationErrors.password?.[0];
          throw new Error(emailError || passwordError || "VALIDATION_ERROR");
        }
        if (retry.parsed.serverError) throw new Error(retry.parsed.serverError);
        if (retry.cookies) {
          const session = saveSession(email, { cookies: retry.cookies, login_method: "next_server_action" });
          logger.info("21online login success (after action ID refresh)", { email, action_id: freshActionId });
          return session;
        }
      }

      throw new Error("login_no_cookies_returned");
    }

    const session = saveSession(email, { cookies, login_method: "next_server_action" });
    logger.info("21online login success", { email, cookie_present: true });
    return session;
  } catch (err) {
    logger.error("21online login error", { email, error: err.message });
    invalidateSession(email, "login_error");
    throw err;
  }
}

module.exports = { login21online, parseServerActionText, invalidateActionIdCache };
