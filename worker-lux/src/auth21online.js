const logger = require("./logger");
const {
  getSession,
  saveSession,
  invalidateSession,
} = require("./sessionManager");

const LOGIN_ACTION_ID = "7ec4e77929af146ecef2369bc094f4fbdbe9ab11";

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
    const args = [{ email, password, redirectUrl: "/dashboard" }];

    const res = await fetch("https://21online.app/login", {
      method: "POST",
      headers: {
        Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": LOGIN_ACTION_ID,
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
      has_validation_errors: Boolean(parsed.validationErrors),
      has_server_error: Boolean(parsed.serverError),
      cookie_present: Boolean(cookies),
    });

    if (parsed.validationErrors) {
      const emailError = parsed.validationErrors.email?.[0];
      const passwordError = parsed.validationErrors.password?.[0];
      throw new Error(emailError || passwordError || "VALIDATION_ERROR");
    }

    if (parsed.serverError) throw new Error(parsed.serverError);
    if (!cookies) throw new Error("login_no_cookies_returned");

    const session = saveSession(email, { cookies, login_method: "next_server_action" });
    logger.info("21online login success", { email, cookie_present: true });
    return session;
  } catch (err) {
    logger.error("21online login error", { email, error: err.message });
    invalidateSession(email, "login_error");
    throw err;
  }
}

module.exports = { login21online, parseServerActionText };
