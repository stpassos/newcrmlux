const logger = require("./logger");

function buildWorkspaceCookie(workspaceId, workspaceName, workspaceType) {
  const payload = { id: workspaceId };
  if (workspaceName) payload.name = workspaceName;
  if (workspaceType) payload.type = workspaceType;
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `workspace=${encoded}`;
}

function mergeWorkspaceCookie(existingCookies, workspaceCookiePair) {
  if (!existingCookies) return workspaceCookiePair;
  const filtered = existingCookies
    .split(";")
    .map(s => s.trim())
    .filter(s => !s.startsWith("workspace="))
    .join("; ");
  return filtered ? `${filtered}; ${workspaceCookiePair}` : workspaceCookiePair;
}

function getWorkspaceCookiePair(workspaceId, workspaceName, workspaceType) {
  const pair = buildWorkspaceCookie(workspaceId, workspaceName, workspaceType);
  logger.info(`[workspaceManager] Built workspace cookie for ${workspaceName || workspaceId}: ${pair}`);
  return pair;
}

module.exports = { buildWorkspaceCookie, mergeWorkspaceCookie, getWorkspaceCookiePair };
