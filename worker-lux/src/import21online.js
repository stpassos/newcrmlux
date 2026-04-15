const logger = require("./logger");
const { login21online } = require("./auth21online");
const { httpRequest } = require("./httpClient");

async function importEntity({ entity, workspace_id, email, password }) {
  logger.info("import entity requested", { entity, workspace_id, email });
  const session = await login21online(email, password);
  logger.debug("session ready for import", { email });

  const endpoint = `https://21online.app/api/${entity}`;
  const response = await httpRequest({ url: endpoint, method: "GET", email, headers: { Cookie: session.cookies } });
  logger.info("import entity response", { entity, status: response.status });

  return { entity, workspace_id, status: response.status, body: response.body };
}

module.exports = { importEntity };
