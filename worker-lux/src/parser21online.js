const logger = require("./logger");

function tryParseJSON(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseLeads(raw) {
  const data = tryParseJSON(raw);
  if (!data) { logger.warn("leads parser received non-json response"); return []; }
  if (!Array.isArray(data)) return [];
  return data.map(item => ({ id: item.id || null, name: item.name || "", email: item.email || "", phone: item.phone || "", created_at: item.created_at || null, raw: item }));
}

function parseTasks(raw) {
  const data = tryParseJSON(raw);
  if (!data) { logger.warn("tasks parser received non-json response"); return []; }
  if (!Array.isArray(data)) return [];
  return data.map(item => ({ id: item.id || null, title: item.title || "", status: item.status || "", due_date: item.due_date || null, raw: item }));
}

function parseEntity(entity, raw) {
  switch (entity) {
    case "leads": return parseLeads(raw);
    case "tasks": return parseTasks(raw);
    default: logger.warn("unknown entity parser", { entity }); return [];
  }
}

module.exports = { parseEntity };
