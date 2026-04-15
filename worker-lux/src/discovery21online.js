const logger = require("./logger");
const { fetch21onlinePage } = require("./workerActions");

const KNOWN_ENDPOINTS = [
  { path: "/api/users", entity: "users", label: "Utilizadores/Consultores", priority: 1 },
  { path: "/api/assets", entity: "assets", label: "Imóveis/Ativos", priority: 1 },
  { path: "/api/workspaces", entity: "workspaces", label: "Workspaces", priority: 3 },
];

const SAFE_EXPANSION_ENDPOINTS = [
  { path: "/api/assets?status=active", entity: "assets_active", label: "Imóveis Ativos", priority: 1 },
  { path: "/api/assets?status=inactive", entity: "assets_inactive", label: "Imóveis Inativos", priority: 2 },
  { path: "/api/assets?status=sold", entity: "assets_sold", label: "Imóveis Vendidos", priority: 1 },
  { path: "/api/assets?status=reserved", entity: "assets_reserved", label: "Imóveis Reservados", priority: 2 },

  { path: "/api/activities", entity: "activities", label: "Atividades", priority: 1 },
  { path: "/api/tasks", entity: "tasks", label: "Tarefas", priority: 1 },
  { path: "/api/notes", entity: "notes", label: "Notas", priority: 1 },
  { path: "/api/visits", entity: "visits", label: "Visitas", priority: 1 },
  { path: "/api/viewings", entity: "viewings", label: "Viewings", priority: 1 },
  { path: "/api/appointments", entity: "appointments", label: "Agendamentos", priority: 1 },

  { path: "/api/leads", entity: "leads", label: "Leads", priority: 2 },
  { path: "/api/opportunities", entity: "opportunities", label: "Oportunidades", priority: 2 },
  { path: "/api/deals", entity: "deals", label: "Negócios", priority: 2 },
  { path: "/api/proposals", entity: "proposals", label: "Propostas", priority: 2 },
  { path: "/api/pipeline", entity: "pipeline", label: "Pipeline", priority: 2 },
  { path: "/api/stages", entity: "stages", label: "Fases Pipeline", priority: 2 },

  { path: "/api/transactions", entity: "transactions", label: "Transações", priority: 3 },
  { path: "/api/closings", entity: "closings", label: "Fechos", priority: 3 },
  { path: "/api/commissions", entity: "commissions", label: "Comissões", priority: 3 },
  { path: "/api/rankings", entity: "rankings", label: "Rankings", priority: 3 },
  { path: "/api/performance", entity: "performance", label: "Performance", priority: 3 },

  { path: "/api/history", entity: "history", label: "Histórico", priority: 4 },
  { path: "/api/timeline", entity: "timeline", label: "Timeline", priority: 4 },
  { path: "/api/audit", entity: "audit", label: "Auditoria", priority: 4 },
  { path: "/api/logs", entity: "logs", label: "Logs", priority: 4 },
  { path: "/api/status-changes", entity: "status_changes", label: "Alterações de Estado", priority: 4 },

  { path: "/api/contacts", entity: "contacts", label: "Contactos", priority: 2 },
  { path: "/api/clients", entity: "clients", label: "Clientes", priority: 2 },
  { path: "/api/owners", entity: "owners", label: "Proprietários", priority: 3 },
  { path: "/api/buyers", entity: "buyers", label: "Compradores", priority: 3 },
  { path: "/api/documents", entity: "documents", label: "Documentos", priority: 4 },
  { path: "/api/events", entity: "events", label: "Eventos", priority: 2 },
  { path: "/api/calendar", entity: "calendar", label: "Calendário", priority: 2 },
  { path: "/api/engagements", entity: "engagements", label: "Angariações", priority: 2 },
  { path: "/api/contracts", entity: "contracts", label: "Contratos", priority: 3 },

  { path: "/api/teams", entity: "teams", label: "Equipas", priority: 4 },
  { path: "/api/agencies", entity: "agencies", label: "Agências", priority: 4 },
  { path: "/api/tags", entity: "tags", label: "Tags", priority: 4 },
  { path: "/api/categories", entity: "categories", label: "Categorias", priority: 4 },
  { path: "/api/zones", entity: "zones", label: "Zonas", priority: 4 },
  { path: "/api/districts", entity: "districts", label: "Distritos", priority: 4 },
  { path: "/api/asset-types", entity: "asset_types", label: "Tipologias", priority: 4 },
  { path: "/api/property-types", entity: "property_types", label: "Tipos Imóvel", priority: 4 },
  { path: "/api/lead-sources", entity: "lead_sources", label: "Origens Lead", priority: 4 },
  { path: "/api/listings", entity: "listings", label: "Anúncios", priority: 3 },
  { path: "/api/properties", entity: "properties", label: "Propriedades", priority: 3 },
];

function buildEndpoints(mode, consultantCrmId) {
  let endpoints = [...KNOWN_ENDPOINTS];

  if (mode === "safe_expansion" || mode === "consultant_audit") {
    endpoints = [...endpoints, ...SAFE_EXPANSION_ENDPOINTS];
  }

  if (mode === "consultant_audit" && consultantCrmId) {
    endpoints = [
      ...endpoints,
      { path: `/api/users/${consultantCrmId}`, entity: "user_detail", label: "Detalhe Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/assets`, entity: "user_assets", label: "Imóveis do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/leads`, entity: "user_leads", label: "Leads do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/activities`, entity: "user_activities", label: "Atividades do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/tasks`, entity: "user_tasks", label: "Tarefas do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/visits`, entity: "user_visits", label: "Visitas do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/proposals`, entity: "user_proposals", label: "Propostas do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/transactions`, entity: "user_transactions", label: "Transações do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/history`, entity: "user_history", label: "Histórico do Consultor", priority: 3 },
      { path: `/api/users/${consultantCrmId}/commissions`, entity: "user_commissions", label: "Comissões do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/performance`, entity: "user_performance", label: "Performance do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/deals`, entity: "user_deals", label: "Negócios do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/engagements`, entity: "user_engagements", label: "Angariações do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/stats`, entity: "user_stats", label: "Estatísticas do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/notes`, entity: "user_notes", label: "Notas do Consultor", priority: 1 },
      { path: `/api/users/${consultantCrmId}/contacts`, entity: "user_contacts", label: "Contactos do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/calendar`, entity: "user_calendar", label: "Calendário do Consultor", priority: 2 },
      { path: `/api/users/${consultantCrmId}/documents`, entity: "user_documents", label: "Documentos do Consultor", priority: 3 },
    ];
  }

  const seen = new Set();
  return endpoints
    .sort((a, b) => a.priority - b.priority)
    .filter((ep) => {
      if (seen.has(ep.path)) return false;
      seen.add(ep.path);
      return true;
    });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runDiscovery({ email, password, mode = "quick", consultant_crm_id = null }) {
  const endpoints = buildEndpoints(mode, consultant_crm_id);

  logger.info("discovery started", {
    email,
    mode,
    consultant_crm_id,
    endpoints: endpoints.length
  });

  const results = [];
  let totalSuccess = 0;
  let totalFailures = 0;

  for (const ep of endpoints) {
    const url = `https://21online.app${ep.path}`;

    try {
      const response = await fetch21onlinePage({
        email,
        password,
        url,
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      const contentType =
        response.headers?.["content-type"] ||
        response.headers?.["Content-Type"] ||
        "";

      const parsed =
        typeof response.body === "string" && contentType.includes("json")
          ? tryParseJson(response.body)
          : null;

      results.push({
        path: ep.path,
        entity: ep.entity,
        label: ep.label,
        priority: ep.priority,
        status: response.status || 0,
        content_type: contentType,
        data: parsed
      });

      if ((response.status || 0) >= 200 && (response.status || 0) < 400) {
        totalSuccess += 1;
      } else {
        totalFailures += 1;
      }

      logger.info("discovery probe finished", {
        email,
        path: ep.path,
        status: response.status || 0
      });
    } catch (err) {
      totalFailures += 1;

      results.push({
        path: ep.path,
        entity: ep.entity,
        label: ep.label,
        priority: ep.priority,
        status: 0,
        content_type: "",
        data: null,
        error: err.message
      });

      logger.error("discovery probe failed", {
        email,
        path: ep.path,
        error: err.message
      });
    }
  }

  return {
    success: true,
    results,
    total_requests: endpoints.length,
    total_success: totalSuccess,
    total_failures: totalFailures
  };
}

module.exports = {
  runDiscovery
};
