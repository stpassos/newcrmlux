-- ============================================================
-- 21online.app → NEWCRMLUX — Esquema PostgreSQL
-- VPS: 149.102.156.188 | DB: newcrmlux
-- Todas as tabelas com prefixo c21_ para evitar conflitos
-- ============================================================

-- ─── Extensões ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Função updated_at ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- WORKSPACES / AGÊNCIAS
-- Endpoint: /api/users (campo agency) | /api/assets (campo agency)
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_workspaces (
  id                UUID PRIMARY KEY,              -- UUID da 21online
  name              TEXT NOT NULL,
  type              TEXT,                          -- 'agency'
  goal              TEXT,
  email             TEXT,
  phone             TEXT,
  address           TEXT,
  image_url         TEXT,
  private_id        INTEGER,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_c21_workspaces_updated_at
  BEFORE UPDATE ON c21_workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AGENTES / CONSULTORES
-- Endpoint: /api/users?workspaceID=...
--           /api/users/{id}  (detalhe)
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_agents (
  id                    UUID PRIMARY KEY,          -- UUID da 21online
  workspace_id          UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  email                 TEXT,
  email_alt             TEXT,
  phone                 TEXT,
  phone_alt             TEXT,
  image_url             TEXT,
  account_type          TEXT,                      -- 'ws_member', 'ws_staff'
  role                  TEXT,                      -- 'ws_agent_team_leader', 'ws_coordinator', etc.
  status                TEXT,                      -- 'active', 'inactive'
  origin                TEXT,                      -- 'pt'
  lang                  TEXT,
  gender                TEXT,
  nif                   TEXT,
  address               TEXT,
  postal_code           TEXT,
  date_of_birth         DATE,
  id_number             TEXT,
  id_expiration_date    DATE,
  iban                  TEXT,
  swift                 TEXT,
  social_security       TEXT,
  contract_start        DATE,
  contract_end          DATE,
  contract_term         TEXT,
  invoice_type          TEXT,
  is_experient          BOOLEAN,
  is_full_time          BOOLEAN,
  has_car               BOOLEAN,
  has_pc                BOOLEAN,
  has_phone             BOOLEAN,
  years_of_experience   INTEGER,
  qualifications        TEXT,
  previous_company      TEXT,
  ranking               BOOLEAN,
  handler               TEXT,
  commission_agent      NUMERIC(5,2),
  commission_bank       NUMERIC(5,2),
  commission_broker     NUMERIC(5,2),
  commission_coordinator NUMERIC(5,2),
  can_handle_contracts  BOOLEAN,
  can_handle_users      BOOLEAN,
  can_handle_reporting  BOOLEAN,
  can_edit_others_data  BOOLEAN,
  workspace_private_id  INTEGER,
  raw                   JSONB,                     -- registo completo
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_c21_agents_updated_at
  BEFORE UPDATE ON c21_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_c21_agents_workspace ON c21_agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_agents_email ON c21_agents(email);

-- ============================================================
-- GALARDÕES / PRÉMIOS
-- Endpoint: /api/users/{id}/awards
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_awards (
  id            UUID PRIMARY KEY,
  agent_id      UUID REFERENCES c21_agents(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  year          INTEGER,
  archived      BOOLEAN DEFAULT false,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_awards_agent ON c21_awards(agent_id);

-- ============================================================
-- CONTACTOS
-- Endpoint: /api/contacts?userID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_contacts (
  id              UUID PRIMARY KEY,
  agent_id        UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  archived        BOOLEAN DEFAULT false,
  official_tags   JSONB DEFAULT '[]',
  contact_tags    JSONB DEFAULT '[]',
  tags            JSONB DEFAULT '[]',
  nif             TEXT,
  ami             TEXT,
  is_rep          BOOLEAN DEFAULT false,
  external_agency TEXT,
  private_id      BIGINT,
  user_id_legacy  BIGINT,                          -- campo user_id numérico da 21online
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_contacts_agent ON c21_contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_c21_contacts_email ON c21_contacts(email);

-- ============================================================
-- IMÓVEIS / ASSETS (lista)
-- Endpoint: /api/assets?workspaceID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_assets (
  id                    UUID PRIMARY KEY,
  workspace_id          UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  agent_id              UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  reference             TEXT,
  address               TEXT,
  asset_type            TEXT,                      -- 'apartment', 'house', 'urban_land', etc.
  sub_asset_type        TEXT,                      -- 'flat', 'building_land', etc.
  ad_type               TEXT,                      -- 'sell', 'rent'
  price                 NUMERIC(14,2),
  gross_area            NUMERIC(10,2),
  useful_area           NUMERIC(10,2),
  terrain_area          NUMERIC(10,2),
  number_of_rooms       INTEGER,
  image_url             TEXT,
  video_url             TEXT,
  virtual_tour_link     TEXT,
  archived              BOOLEAN DEFAULT false,
  comments_count        INTEGER DEFAULT 0,
  tasks_count           INTEGER DEFAULT 0,
  visits_count          INTEGER DEFAULT 0,
  proposals_count       INTEGER DEFAULT 0,
  has_businesses_associated BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_c21_assets_updated_at
  BEFORE UPDATE ON c21_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_c21_assets_workspace ON c21_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_assets_agent ON c21_assets(agent_id);
CREATE INDEX IF NOT EXISTS idx_c21_assets_reference ON c21_assets(reference);
CREATE INDEX IF NOT EXISTS idx_c21_assets_type ON c21_assets(asset_type, ad_type);

-- ============================================================
-- CONTRATOS ATIVOS (embedded no asset)
-- Normalizado da lista de assets
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_asset_contracts (
  id                          UUID PRIMARY KEY,
  asset_id                    UUID NOT NULL REFERENCES c21_assets(id) ON DELETE CASCADE,
  status                      TEXT,               -- 'approved', 'pending', etc.
  ad_type                     TEXT,
  reference                   TEXT,
  commission_type             TEXT,               -- 'percentage', 'fixed'
  commission_percentage       NUMERIC(5,2),
  commission_percentage_contract NUMERIC(5,2),
  commission_percentage_sign  NUMERIC(5,2),
  commission_value            NUMERIC(14,2),
  commission_value_contract   NUMERIC(14,2),
  commission_value_sign       NUMERIC(14,2),
  commission_min_value        NUMERIC(14,2),
  price                       NUMERIC(14,2),
  imported_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_asset_contracts_asset ON c21_asset_contracts(asset_id);

-- ============================================================
-- DETALHE COMPLETO DO IMÓVEL
-- Endpoint: /api/assets/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_asset_details (
  asset_id              UUID PRIMARY KEY REFERENCES c21_assets(id) ON DELETE CASCADE,
  public_id             UUID,
  title                 TEXT,
  description           TEXT,
  lat                   NUMERIC(10,7),
  lng                   NUMERIC(10,7),
  pov                   JSONB,
  building_number       TEXT,
  door_number           TEXT,
  postal_code           TEXT,
  country               TEXT,
  ad_1                  TEXT,                     -- distrito
  ad_1_id               TEXT,
  ad_2                  TEXT,                     -- concelho
  ad_2_id               TEXT,
  ad_3                  TEXT,                     -- freguesia
  ad_3_id               TEXT,
  ad_4                  TEXT,
  ad_4_id               TEXT,
  zones                 JSONB DEFAULT '[]',
  zones_ids             JSONB,
  condition             TEXT,                     -- 'renovated', 'good', 'new', etc.
  energy_efficiency     TEXT,
  energy_value          NUMERIC(10,2),
  emissions_ratings     TEXT,
  emissions_value       NUMERIC(10,2),
  consumption_rating    TEXT,
  building_year         INTEGER,
  floor_number          TEXT,
  number_of_floors      INTEGER,
  number_of_divisions   INTEGER,
  number_of_wcs         INTEGER,
  number_of_parking_spots INTEGER,
  rent_price            NUMERIC(14,2),
  trespass_price        NUMERIC(14,2),
  rental_deposit_amount NUMERIC(14,2),
  rental_deposit_months INTEGER,
  min_rental_period     INTEGER,
  max_rental_period     INTEGER,
  max_tenants           INTEGER,
  condo_value           NUMERIC(14,2),
  fiscal_value          NUMERIC(14,2),
  imi_value             NUMERIC(14,2),
  transfer_value        NUMERIC(14,2),
  current_occupation    TEXT,
  cadastral_reference   TEXT,
  impic_building_type   TEXT,
  impic_permanent_residence BOOLEAN,
  impic_purpose         TEXT,
  impic_terrain_type    TEXT,
  sub_rent_type         TEXT,
  old_id                TEXT,
  migrated_at           TIMESTAMPTZ,
  migrated_from         TEXT,
  gallery               JSONB DEFAULT '[]',       -- array de {id, link, order}
  characteristics       JSONB DEFAULT '[]',
  documents_raw         JSONB DEFAULT '[]',
  registry              JSONB,
  pipeline_owner        JSONB,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INFO PÚBLICA (engine.century21.pt)
-- Endpoint: /exporters/asset-info?reference=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_asset_info_engine (
  reference             TEXT PRIMARY KEY,
  asset_id              UUID REFERENCES c21_assets(id) ON DELETE SET NULL,
  asset_type            TEXT,
  sub_asset_type        TEXT,
  ad_type               TEXT,
  price                 NUMERIC(14,2),
  title                 JSONB,                    -- {en, es, fr, pt}
  description           JSONB,                    -- {en, es, fr, pt}
  images                JSONB DEFAULT '[]',
  zones                 JSONB DEFAULT '[]',
  raw                   JSONB,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_asset_info_engine_asset ON c21_asset_info_engine(asset_id);

-- ============================================================
-- VENDEDORES / OWNERS (pipeline)
-- Endpoint: /api/owners?workspaceID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_owners (
  id              UUID PRIMARY KEY,
  workspace_id    UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  agent_id        UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  asset_id        UUID REFERENCES c21_assets(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES c21_contacts(id) ON DELETE SET NULL,
  status          TEXT,                           -- 'lead', 'referred', 'active', etc.
  reference       TEXT,
  price           NUMERIC(14,2),
  ad_type         TEXT,
  archived        BOOLEAN DEFAULT false,
  buyers_count    INTEGER DEFAULT 0,
  proposals_count INTEGER DEFAULT 0,
  visits_count    INTEGER DEFAULT 0,
  comments_count  INTEGER DEFAULT 0,
  tasks_count     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_owners_workspace ON c21_owners(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_owners_agent ON c21_owners(agent_id);
CREATE INDEX IF NOT EXISTS idx_c21_owners_asset ON c21_owners(asset_id);
CREATE INDEX IF NOT EXISTS idx_c21_owners_contact ON c21_owners(contact_id);

-- ============================================================
-- COMPRADORES / BUYERS (pipeline)
-- Endpoint: /api/buyers?workspaceID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_buyers (
  id              UUID PRIMARY KEY,
  workspace_id    UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  agent_id        UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES c21_contacts(id) ON DELETE SET NULL,
  status          TEXT,                           -- 'lead', 'active', etc.
  archived        BOOLEAN DEFAULT false,
  proposals_count INTEGER DEFAULT 0,
  visits_count    INTEGER DEFAULT 0,
  comments_count  INTEGER DEFAULT 0,
  tasks_count     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_buyers_workspace ON c21_buyers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_buyers_agent ON c21_buyers(agent_id);
CREATE INDEX IF NOT EXISTS idx_c21_buyers_contact ON c21_buyers(contact_id);

-- ============================================================
-- TRANSAÇÕES / NEGÓCIOS
-- Endpoint: /api/transactions?workspaceID=...
--           /api/users/{id}/transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_transactions (
  id                UUID PRIMARY KEY,
  workspace_id      UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  asset_id          UUID REFERENCES c21_assets(id) ON DELETE SET NULL,
  buyer_id          UUID REFERENCES c21_buyers(id) ON DELETE SET NULL,
  owner_rep_agent_id UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  buyer_rep_agent_id UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  reference         TEXT,
  status            TEXT,                         -- 'open', 'sign', 'cpcv', 'deed', 'closed'
  ad_type           TEXT,                         -- 'sell', 'rent'
  price             NUMERIC(14,2),
  archived          BOOLEAN DEFAULT false,
  -- dados desnormalizados para referência rápida
  asset_address     TEXT,
  buyer_name        TEXT,
  owner_name        TEXT,
  owner_rep_name    TEXT,
  owner_rep_agency  TEXT,
  owner_rep_internal BOOLEAN,
  buyer_rep_name    TEXT,
  buyer_rep_agency  TEXT,
  buyer_rep_internal BOOLEAN,
  created_at        TIMESTAMPTZ,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_c21_transactions_updated_at
  BEFORE UPDATE ON c21_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_c21_transactions_workspace ON c21_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_transactions_asset ON c21_transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_c21_transactions_status ON c21_transactions(status);
CREATE INDEX IF NOT EXISTS idx_c21_transactions_reference ON c21_transactions(reference);

-- ============================================================
-- REFERÊNCIAS / REFERRALS
-- Endpoint: /api/referrals?workspaceID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_referrals (
  id                  UUID PRIMARY KEY,
  workspace_id        UUID REFERENCES c21_workspaces(id) ON DELETE SET NULL,
  topic_type          TEXT,                       -- 'buyers', 'owners'
  topic               UUID,                       -- ID do buyer ou owner
  status              TEXT,                       -- 'pending', 'accepted', 'rejected'
  accepted            BOOLEAN DEFAULT false,
  decision_date       TIMESTAMPTZ,
  pipeline_status     TEXT,
  topic_origin        TEXT,
  user_destination_name   TEXT,
  user_destination_agency TEXT,
  user_origin_name        TEXT,
  user_origin_agency      TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  created_at          TIMESTAMPTZ,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_referrals_workspace ON c21_referrals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_referrals_topic ON c21_referrals(topic_type, topic);

-- ============================================================
-- VISITAS
-- Endpoint: /api/users/{id}/visits
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_visits (
  id                      UUID PRIMARY KEY,
  asset_id                UUID REFERENCES c21_assets(id) ON DELETE SET NULL,
  agent_id                UUID REFERENCES c21_agents(id) ON DELETE SET NULL,  -- buyer_rep
  contact_id              UUID REFERENCES c21_contacts(id) ON DELETE SET NULL,
  topic                   UUID,                   -- buyer_id ou owner_id
  topic_type              TEXT,                   -- 'buyers', 'owners'
  status                  TEXT,                   -- 'scheduled', 'done', 'canceled'
  notes                   TEXT,
  visit_date              TIMESTAMPTZ,
  reference               TEXT,
  accepted_by_contact_rep BOOLEAN DEFAULT false,
  accepted_by_asset_rep   BOOLEAN DEFAULT false,
  buyer_name              TEXT,
  buyer_email             TEXT,
  owner_rep_id            UUID,
  owner_rep_name          TEXT,
  owner_rep_agency        TEXT,
  buyer_rep_id            UUID,
  buyer_rep_name          TEXT,
  buyer_rep_agency        TEXT,
  created_at              TIMESTAMPTZ,
  imported_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_visits_asset ON c21_visits(asset_id);
CREATE INDEX IF NOT EXISTS idx_c21_visits_agent ON c21_visits(agent_id);
CREATE INDEX IF NOT EXISTS idx_c21_visits_date ON c21_visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_c21_visits_status ON c21_visits(status);

-- ============================================================
-- PROPOSTAS
-- Endpoint: /api/users/{id}/proposals
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_proposals (
  id              UUID PRIMARY KEY,
  transaction_id  UUID REFERENCES c21_transactions(id) ON DELETE SET NULL,
  asset_id        UUID REFERENCES c21_assets(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES c21_contacts(id) ON DELETE SET NULL,
  reference       TEXT,
  amount          NUMERIC(14,2),
  status          TEXT,                           -- 'pending', 'accepted', 'rejected', 'countered'
  asset_address   TEXT,
  asset_image_url TEXT,
  contact_name    TEXT,
  proposal_date   TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_proposals_transaction ON c21_proposals(transaction_id);
CREATE INDEX IF NOT EXISTS idx_c21_proposals_asset ON c21_proposals(asset_id);
CREATE INDEX IF NOT EXISTS idx_c21_proposals_status ON c21_proposals(status);

-- ============================================================
-- DOCUMENTOS
-- Endpoint: /api/documents?userID=...
--           /api/documents?ownerID=...
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_documents (
  id                    UUID PRIMARY KEY,
  agent_id              UUID REFERENCES c21_agents(id) ON DELETE SET NULL,
  topic                 UUID,                     -- ID do owner, buyer, asset, etc.
  topic_type            TEXT,                     -- 'movements', 'owners', 'buyers', 'assets', etc.
  file_name             TEXT,
  file_type             TEXT,
  file_size             BIGINT,
  url                   TEXT,
  label                 TEXT,                     -- 'comment', 'contract', etc.
  status                TEXT,
  has_valid_license     BOOLEAN DEFAULT false,
  signaturit_id         TEXT,
  signaturit_document_id TEXT,
  private_id            BIGINT,
  created_at            TIMESTAMPTZ,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c21_documents_topic ON c21_documents(topic_type, topic);
CREATE INDEX IF NOT EXISTS idx_c21_documents_agent ON c21_documents(agent_id);

-- ============================================================
-- LOG DE IMPORTAÇÃO
-- Regista cada execução de import para auditoria
-- ============================================================
CREATE TABLE IF NOT EXISTS c21_import_log (
  id            BIGSERIAL PRIMARY KEY,
  entity        TEXT NOT NULL,                    -- 'agents', 'assets', etc.
  workspace_id  UUID,
  records_total INTEGER DEFAULT 0,
  records_inserted INTEGER DEFAULT 0,
  records_updated  INTEGER DEFAULT 0,
  records_error    INTEGER DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  error_msg     TEXT
);
