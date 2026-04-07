-- ============================================================
-- NEWCRMLUX — Schema PostgreSQL Completo
-- VPS: 149.102.156.188 | DB: newcrmlux
-- ============================================================

-- ─── Extensions ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE agencia_estado AS ENUM ('ativa', 'inativa', 'suspensa');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE availability_period AS ENUM ('manha', 'tarde');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE availability_submission_status AS ENUM ('draft', 'submitted', 'approved');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE candidato_status AS ENUM ('pendente', 'em_analise', 'aprovado', 'rejeitado');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE user_type AS ENUM ('admin', 'comercial', 'funcionario');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE storage_visibility AS ENUM ('public', 'private');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Função updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ORGANIZAÇÃO
-- ============================================================

CREATE TABLE IF NOT EXISTS organizacao_principal (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_organizacao          TEXT NOT NULL,
  nome_comercial            TEXT NOT NULL,
  ami                       TEXT,
  registo_banco_portugal    TEXT,
  companhia_seguro          TEXT,
  apolice_seguro_numero     TEXT,
  apolice_valida_de         DATE,
  apolice_valida_ate        DATE,
  disclaimer                TEXT,
  rede                      TEXT DEFAULT 'CENTURY21',
  nome_franchising          TEXT,
  logotipo_url              TEXT,
  nif                       TEXT,
  morada                    TEXT,
  email                     TEXT,
  telefone                  TEXT,
  website                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_organizacao_updated_at
  BEFORE UPDATE ON organizacao_principal
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- UTILIZADORES (Auth própria — sem Supabase)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  user_type       user_type NOT NULL DEFAULT 'comercial',
  is_active       BOOLEAN DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tokens de sessão / reset de password
CREATE TABLE IF NOT EXISTS user_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  type        TEXT NOT NULL, -- 'access_invite' | 'password_reset'
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_token ON user_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON user_tokens(user_id);

-- ============================================================
-- ESTRUTURA ORGANIZACIONAL
-- ============================================================

CREATE TABLE IF NOT EXISTS cargos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_cargos_updated_at
  BEFORE UPDATE ON cargos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS departamentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_departamentos_updated_at
  BEFORE UPDATE ON departamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS agencias (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id            UUID REFERENCES organizacao_principal(id),
  nome                      TEXT NOT NULL,
  morada                    TEXT,
  localidade                TEXT,
  cidade                    TEXT,
  codigo_postal             TEXT,
  email                     TEXT,
  telefone                  TEXT,
  estado                    agencia_estado DEFAULT 'ativa',
  url_c21                   TEXT,
  storage_slug              TEXT UNIQUE, -- usado para paths de storage
  -- Horários (7 dias × manhã/tarde × início/fim)
  segunda_manha_inicio TEXT, segunda_manha_fim TEXT,
  segunda_tarde_inicio TEXT, segunda_tarde_fim TEXT,
  terca_manha_inicio TEXT,   terca_manha_fim TEXT,
  terca_tarde_inicio TEXT,   terca_tarde_fim TEXT,
  quarta_manha_inicio TEXT,  quarta_manha_fim TEXT,
  quarta_tarde_inicio TEXT,  quarta_tarde_fim TEXT,
  quinta_manha_inicio TEXT,  quinta_manha_fim TEXT,
  quinta_tarde_inicio TEXT,  quinta_tarde_fim TEXT,
  sexta_manha_inicio TEXT,   sexta_manha_fim TEXT,
  sexta_tarde_inicio TEXT,   sexta_tarde_fim TEXT,
  sabado_manha_inicio TEXT,  sabado_manha_fim TEXT,
  sabado_tarde_inicio TEXT,  sabado_tarde_fim TEXT,
  domingo_manha_inicio TEXT, domingo_manha_fim TEXT,
  domingo_tarde_inicio TEXT, domingo_tarde_fim TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agencias_updated_at
  BEFORE UPDATE ON agencias
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- COMERCIAIS
-- ============================================================

CREATE TABLE IF NOT EXISTS comerciais (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  nome                    TEXT NOT NULL,
  email                   TEXT NOT NULL UNIQUE,
  contacto                TEXT,
  cargo_id                UUID REFERENCES cargos(id),
  agencia_principal_id    UUID REFERENCES agencias(id),
  team_leader_id          UUID REFERENCES comerciais(id),
  data_nascimento         DATE,
  data_entrada            DATE,
  documento_identificacao TEXT,
  nif                     TEXT,
  pin_impressora          TEXT,
  foto_url                TEXT,
  biografia               TEXT,
  notas_internas          TEXT,
  estado                  TEXT DEFAULT 'ativo',
  arquivado               BOOLEAN DEFAULT false,
  arquivado_em            TIMESTAMPTZ,
  -- Redes sociais
  facebook TEXT, instagram TEXT, linkedin TEXT,
  tiktok TEXT, youtube TEXT, website TEXT, url_mysite TEXT,
  -- CRM 21online
  crm_id                  TEXT, -- ID externo no 21online
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_comerciais_updated_at
  BEFORE UPDATE ON comerciais
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_comerciais_email ON comerciais(email);
CREATE INDEX IF NOT EXISTS idx_comerciais_crm_id ON comerciais(crm_id);

CREATE TABLE IF NOT EXISTS comercial_agencias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comercial_id  UUID NOT NULL REFERENCES comerciais(id) ON DELETE CASCADE,
  agencia_id    UUID NOT NULL REFERENCES agencias(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(comercial_id, agencia_id)
);

-- ============================================================
-- FUNCIONÁRIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS funcionarios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  nome                    TEXT NOT NULL,
  email                   TEXT NOT NULL UNIQUE,
  contacto                TEXT,
  cargo_id                UUID REFERENCES cargos(id),
  departamento_id         UUID REFERENCES departamentos(id),
  data_nascimento         DATE,
  data_entrada            DATE,
  documento_identificacao TEXT,
  nif                     TEXT,
  pin_impressora          TEXT,
  foto_url                TEXT,
  facebook TEXT, instagram TEXT, linkedin TEXT,
  tiktok TEXT, youtube TEXT, url_mysite TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_funcionarios_updated_at
  BEFORE UPDATE ON funcionarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS funcionario_agencias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  UUID NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  agencia_id      UUID NOT NULL REFERENCES agencias(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(funcionario_id, agencia_id)
);

-- ============================================================
-- STORAGE (ficheiros no disco local da VPS)
-- ============================================================

CREATE TABLE IF NOT EXISTS storage_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Localização no disco
  file_path         TEXT NOT NULL UNIQUE, -- caminho relativo: public/properties/uuid/foto.jpg
  file_url          TEXT,                 -- URL pública (se public)
  visibility        storage_visibility NOT NULL DEFAULT 'private',
  -- Metadados
  original_filename TEXT NOT NULL,
  normalized_filename TEXT,
  mime_type         TEXT,
  file_ext          TEXT,
  size_bytes        BIGINT,
  checksum          TEXT,
  -- Contexto
  module            TEXT,       -- 'property_image' | 'property_doc' | 'avatar' | etc.
  entity_type       TEXT,       -- 'property' | 'comercial' | 'document' | etc.
  entity_id         UUID,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Estado
  is_active         BOOLEAN DEFAULT true,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_storage_files_updated_at
  BEFORE UPDATE ON storage_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_storage_files_entity ON storage_files(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_module ON storage_files(module);

-- ============================================================
-- IMÓVEIS — Tabela consolidada (substitui imoveis + crm21_raw_* + crm21_n_*)
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identidade / Sync CRM ───────────────────────────────
  referencia            TEXT UNIQUE,
  crm_external_id       TEXT,
  crm_workspace_id      TEXT,
  crm_workspace_name    TEXT,
  crm_connection_id     TEXT,
  crm_status            TEXT,
  crm_imported_at       TIMESTAMPTZ,
  last_synced_at        TIMESTAMPTZ,

  -- ── Classificação ───────────────────────────────────────
  tipo_imovel           TEXT,
  sub_asset_type        TEXT,
  tipo_negocio          TEXT,     -- 'venda' | 'arrendamento' | 'trespasse'
  ad_type               TEXT,     -- raw do CRM

  -- ── Localização ─────────────────────────────────────────
  address               TEXT,
  postal_code           TEXT,
  cidade                TEXT,
  distrito              TEXT,
  country               TEXT DEFAULT 'Portugal',
  latitude              NUMERIC,
  longitude             NUMERIC,

  -- ── Características físicas ─────────────────────────────
  area_util             NUMERIC,
  gross_area            NUMERIC,
  terrain_area          NUMERIC,
  numero_quartos        INTEGER,
  number_of_wcs         INTEGER,
  number_of_parking_spots INTEGER,

  -- ── Financeiro ──────────────────────────────────────────
  preco                 NUMERIC,
  price                 NUMERIC,
  fiscal_value          NUMERIC,
  imi_value             NUMERIC,
  condo_value           NUMERIC,
  transfer_value        NUMERIC,
  trespass_price        NUMERIC,
  taxa_esforco_required NUMERIC,

  -- ── Qualidade ───────────────────────────────────────────
  condition             TEXT,
  energy_efficiency     TEXT,
  building_year         INTEGER,

  -- ── Conteúdo ────────────────────────────────────────────
  ad_title              TEXT,
  descricao             TEXT,
  description_pt        TEXT,
  foto_url              TEXT,
  export_to_website     BOOLEAN DEFAULT false,
  url_mysite            TEXT,
  ad_url                TEXT,
  ad_1 TEXT, ad_2 TEXT, ad_3 TEXT,

  -- ── Status ──────────────────────────────────────────────
  estado                TEXT DEFAULT 'Disponível',
  archived              BOOLEAN DEFAULT false,
  archived_at           TIMESTAMPTZ,

  -- ── Registo predial ─────────────────────────────────────
  registry_office               TEXT,
  registry_office_number        TEXT,
  urban_registry_article        TEXT,
  housing_license_number        TEXT,
  housing_license_date          DATE,
  housing_license_entity        TEXT,
  construction_license_number   TEXT,
  construction_license_date     DATE,

  -- ── IMPIC ───────────────────────────────────────────────
  impic_building_type   TEXT,
  impic_terrain_type    TEXT,
  impic_purpose         TEXT,
  impic_permanent_residence BOOLEAN,

  -- ── CMI ─────────────────────────────────────────────────
  data_cmi              DATE,
  cmi_duration          INTEGER,

  -- ── Divisões (boolean) ──────────────────────────────────
  kitchen BOOLEAN, living_room BOOLEAN, bedroom BOOLEAN,
  bathroom BOOLEAN, suite BOOLEAN, garage_room BOOLEAN,
  garden BOOLEAN, terrace BOOLEAN, balconies BOOLEAN,
  bar_room BOOLEAN, cinema_room BOOLEAN, library BOOLEAN,
  laundry BOOLEAN, storage_room BOOLEAN, office BOOLEAN,
  gym BOOLEAN, playground BOOLEAN, common_areas BOOLEAN,
  elevator BOOLEAN, air_conditioning BOOLEAN, central_heating BOOLEAN,
  solar_panels BOOLEAN, swimming_pool BOOLEAN, barbecue BOOLEAN,
  jacuzzi BOOLEAN, alarm BOOLEAN, video_surveillance BOOLEAN,
  equipped_kitchen BOOLEAN, furnished BOOLEAN,

  -- ── Docs candidatos arrendamento ────────────────────────
  docs_cc BOOLEAN, docs_recibos_vencimento BOOLEAN,
  docs_comprovativo_irs BOOLEAN, docs_liquidacao_irs BOOLEAN,
  docs_cc_fiador BOOLEAN, docs_recibos_vencimento_fiador BOOLEAN,
  docs_comprovativo_irs_fiador BOOLEAN, docs_liquidacao_irs_fiador BOOLEAN,
  docs_request_token            TEXT,
  docs_request_link_active      BOOLEAN DEFAULT false,
  docs_request_link_generated_at TIMESTAMPTZ,

  -- ── Relações ────────────────────────────────────────────
  consultor_id          UUID REFERENCES comerciais(id) ON DELETE SET NULL,
  agencia_id            UUID REFERENCES agencias(id) ON DELETE SET NULL,

  -- ── Payloads brutos consolidados do 21online ────────────
  -- Todos os endpoints numa só coluna JSONB por tipo
  crm_payload           JSONB,   -- /api/assets/{id} — payload completo
  crm_owner_payload     JSONB,   -- dados do proprietário/owner
  crm_contract_payload  JSONB,   -- dados do contrato ativo
  crm_documents_payload JSONB,   -- lista de documentos (certidões, licenças)
  crm_images_payload    JSONB,   -- lista de imagens do 21online
  crm_user_payload      JSONB,   -- dados do consultor no CRM

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_properties_referencia ON properties(referencia);
CREATE INDEX IF NOT EXISTS idx_properties_crm_external_id ON properties(crm_external_id);
CREATE INDEX IF NOT EXISTS idx_properties_crm_workspace ON properties(crm_workspace_id);
CREATE INDEX IF NOT EXISTS idx_properties_consultor ON properties(consultor_id);
CREATE INDEX IF NOT EXISTS idx_properties_estado ON properties(estado);
CREATE INDEX IF NOT EXISTS idx_properties_tipo_negocio ON properties(tipo_negocio);

-- Imagens do imóvel
CREATE TABLE IF NOT EXISTS property_images (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  storage_file_id   UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  url               TEXT NOT NULL,
  crm_image_id      TEXT,
  crm_image_url     TEXT,   -- URL original do 21online
  ordem             INTEGER DEFAULT 0,
  is_cover          BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id);
CREATE INDEX IF NOT EXISTS idx_property_images_ordem ON property_images(property_id, ordem);

-- Documentos do imóvel
CREATE TABLE IF NOT EXISTS property_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  storage_file_id UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  document_type   TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_url        TEXT,
  file_ext        TEXT,
  file_size       BIGINT DEFAULT 0,
  mime_type       TEXT,
  is_confidential BOOLEAN DEFAULT false,
  source          TEXT DEFAULT 'manual', -- 'manual' | 'crm_import'
  crm_doc_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_property_documents_updated_at
  BEFORE UPDATE ON property_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_property_documents_property ON property_documents(property_id);

-- ============================================================
-- LEADS
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_name             TEXT NOT NULL,
  lead_email            TEXT,
  lead_phone            TEXT,
  lead_source           TEXT,
  lead_received_at      TIMESTAMPTZ,
  lead_status           TEXT DEFAULT 'nova',
  assigned_agent_id     UUID REFERENCES comerciais(id) ON DELETE SET NULL,
  listing_reference     TEXT,
  listing_business_type TEXT,
  listing_title         TEXT,
  listing_address       TEXT,
  listing_price         NUMERIC,
  property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
  contact_type          TEXT, -- 'comprador' | 'proprietario' | 'arrendatario' | 'outro'
  notes                 TEXT,
  is_read               BOOLEAN DEFAULT false,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  -- CRM 21online
  crm_lead_id           TEXT,
  crm_workspace_id      TEXT,
  crm_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_lead_contacts_updated_at
  BEFORE UPDATE ON lead_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_lead_contacts_agent ON lead_contacts(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_status ON lead_contacts(lead_status);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_crm_id ON lead_contacts(crm_lead_id);

-- Sub-entidades de leads
CREATE TABLE IF NOT EXISTS lead_visits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  visit_date       TIMESTAMPTZ NOT NULL,
  visit_notes      TEXT,
  visit_status     TEXT DEFAULT 'agendada',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_meetings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  meeting_date     TIMESTAMPTZ NOT NULL,
  meeting_location TEXT,
  meeting_notes    TEXT,
  meeting_status   TEXT DEFAULT 'agendada',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  proposal_value   NUMERIC,
  proposal_notes   TEXT,
  proposal_status  TEXT DEFAULT 'pendente',
  proposal_date    TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_cpcv (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  cpcv_date        TIMESTAMPTZ,
  cpcv_notes       TEXT,
  cpcv_status      TEXT DEFAULT 'agendado',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_contrato (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  contrato_date    TIMESTAMPTZ,
  contrato_notes   TEXT,
  contrato_status  TEXT DEFAULT 'agendado',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_escritura (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_contact_id  UUID NOT NULL REFERENCES lead_contacts(id) ON DELETE CASCADE,
  escritura_date   TIMESTAMPTZ,
  escritura_notes  TEXT,
  escritura_status TEXT DEFAULT 'agendada',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOCUMENTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS document_families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  icon        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_document_families_updated_at
  BEFORE UPDATE ON document_families
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS document_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID REFERENCES document_families(id),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT DEFAULT 'geral',
  family_id           UUID REFERENCES document_families(id),
  type_id             UUID REFERENCES document_types(id),
  smartpdf_id         TEXT,
  storage_file_id     UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  -- Campos legados (manter compatibilidade)
  file_name           TEXT,
  file_ext            TEXT,
  file_url            TEXT,
  file_size           BIGINT,
  mime_type           TEXT,
  thumbnail_url       TEXT,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  activo              BOOLEAN DEFAULT true,
  version             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SMART PDF BUILDER
-- ============================================================

CREATE TABLE IF NOT EXISTS smartpdf_templates (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  categoria   TEXT,
  settings    JSONB NOT NULL DEFAULT '{}',
  pages       JSONB NOT NULL DEFAULT '[]',
  form_schema JSONB NOT NULL DEFAULT '{"fields":[],"groups":[]}',
  ativo       BOOLEAN DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_smartpdf_updated_at
  BEFORE UPDATE ON smartpdf_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- INTERMEDIAÇÃO BANCÁRIA
-- ============================================================

CREATE TABLE IF NOT EXISTS parceiros_bancarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  logo_url    TEXT,
  contacto    TEXT,
  email       TEXT,
  notas       TEXT,
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_parceiros_updated_at
  BEFORE UPDATE ON parceiros_bancarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS tipos_documento_bancario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  descricao       TEXT,
  obrigatorio     BOOLEAN DEFAULT false,
  ordem           INTEGER DEFAULT 0,
  activo          BOOLEAN DEFAULT true,
  dynamic_config  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_tipos_doc_bancario_updated_at
  BEFORE UPDATE ON tipos_documento_bancario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS processos_credito (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_cliente          TEXT NOT NULL,
  email_cliente         TEXT,
  telefone_cliente      TEXT,
  nif_cliente           TEXT,
  valor_imovel          NUMERIC,
  valor_financiamento   NUMERIC,
  parceiro_id           UUID REFERENCES parceiros_bancarios(id),
  estado                TEXT DEFAULT 'em_analise',
  notas                 TEXT,
  docs_request_token    TEXT,
  docs_request_active   BOOLEAN DEFAULT false,
  tipos_solicitados     JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_processos_credito_updated_at
  BEFORE UPDATE ON processos_credito
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS documentos_processo_credito (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id          UUID NOT NULL REFERENCES processos_credito(id) ON DELETE CASCADE,
  tipo_documento_id    UUID REFERENCES tipos_documento_bancario(id),
  storage_file_id      UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  file_name            TEXT NOT NULL,
  file_url             TEXT,
  file_size            BIGINT,
  mime_type            TEXT,
  display_name         TEXT,
  period_key           TEXT,
  version              INTEGER DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_docs_processo_updated_at
  BEFORE UPDATE ON documentos_processo_credito
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS email_templates_bancarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  assunto     TEXT NOT NULL,
  corpo       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- COORDENAÇÃO / ESCALAS
-- ============================================================

CREATE TABLE IF NOT EXISTS schedule_cycles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             UUID NOT NULL REFERENCES agencias(id) ON DELETE CASCADE,
  month                 INTEGER NOT NULL,
  year                  INTEGER NOT NULL,
  status                TEXT DEFAULT 'draft',
  submission_deadline   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agency_id, month, year)
);

CREATE TRIGGER trg_schedule_cycles_updated_at
  BEFORE UPDATE ON schedule_cycles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS availability_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_cycle_id   UUID NOT NULL REFERENCES schedule_cycles(id) ON DELETE CASCADE,
  comercial_id        UUID NOT NULL REFERENCES comerciais(id) ON DELETE CASCADE,
  status              availability_submission_status DEFAULT 'draft',
  locked              BOOLEAN DEFAULT false,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(schedule_cycle_id, comercial_id)
);

CREATE TRIGGER trg_availability_submissions_updated_at
  BEFORE UPDATE ON availability_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS availability_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES availability_submissions(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  period          availability_period NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scale_slots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_cycle_id   UUID NOT NULL REFERENCES schedule_cycles(id) ON DELETE CASCADE,
  comercial_id        UUID NOT NULL REFERENCES comerciais(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  period              TEXT NOT NULL,
  assigned_by         TEXT DEFAULT 'admin',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_scale_rules (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                         UUID NOT NULL UNIQUE REFERENCES agencias(id) ON DELETE CASCADE,
  max_shifts_per_consultant_month   INTEGER DEFAULT 22,
  max_same_weekday_per_month        INTEGER DEFAULT 4,
  edit_time_limit_minutes           INTEGER DEFAULT 30,
  allow_consultant_edit_admin_slots BOOLEAN DEFAULT false,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   UUID NOT NULL REFERENCES agencias(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  capacity    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CRM 21ONLINE — Conexões e Jobs de Sync
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_id          UUID REFERENCES agencias(id) ON DELETE SET NULL,
  email               TEXT NOT NULL,
  base_url            TEXT NOT NULL DEFAULT 'https://21online.app',
  encrypted_session   TEXT,
  workspace_id        TEXT,
  workspace_name      TEXT,
  last_sync_at        TIMESTAMPTZ,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_crm_connections_updated_at
  BEFORE UPDATE ON crm_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS crm21_sync_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID REFERENCES crm_connections(id) ON DELETE SET NULL,
  workspace_id          TEXT,
  workspace_name        TEXT,
  entity                TEXT NOT NULL,   -- 'assets' | 'leads' | 'users' | 'all'
  status                TEXT DEFAULT 'queued', -- 'queued'|'running'|'completed'|'failed'|'paused'
  total_records         INTEGER DEFAULT 0,
  processed_records     INTEGER DEFAULT 0,
  failed_records        INTEGER DEFAULT 0,
  checkpoint            JSONB,
  error_message         TEXT,
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_crm21_sync_jobs_updated_at
  BEFORE UPDATE ON crm21_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_crm21_sync_jobs_status ON crm21_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crm21_sync_jobs_connection ON crm21_sync_jobs(connection_id);

-- ============================================================
-- CANDIDATOS ARRENDAMENTO
-- ============================================================

CREATE TABLE IF NOT EXISTS candidatos_arrendamento (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                 UUID REFERENCES properties(id) ON DELETE CASCADE,
  nome                        TEXT NOT NULL,
  email                       TEXT NOT NULL,
  contacto                    TEXT NOT NULL,
  status                      candidato_status DEFAULT 'pendente',
  score                       INTEGER,
  documents_required_count    INTEGER DEFAULT 0,
  documents_uploaded_count    INTEGER DEFAULT 0,
  submitted_at                TIMESTAMPTZ,
  accessed_at                 TIMESTAMPTZ DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_candidatos_updated_at
  BEFORE UPDATE ON candidatos_arrendamento
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS candidato_documentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id    UUID NOT NULL REFERENCES candidatos_arrendamento(id) ON DELETE CASCADE,
  storage_file_id UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  document_key    TEXT NOT NULL,
  document_label  TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_url        TEXT,
  file_size       BIGINT,
  uploaded_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CONFIGURAÇÕES
-- ============================================================

CREATE TABLE IF NOT EXISTS email_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_host       TEXT NOT NULL,
  smtp_port       INTEGER DEFAULT 587,
  smtp_username   TEXT NOT NULL,
  smtp_password   TEXT NOT NULL,
  encryption_type TEXT DEFAULT 'tls',
  sender_email    TEXT NOT NULL,
  sender_name     TEXT DEFAULT '',
  is_enabled      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON email_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Permissões por departamento
CREATE TABLE IF NOT EXISTS departamento_permissoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  departamento_id   UUID NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
  modulo            TEXT NOT NULL,
  pode_ver          BOOLEAN DEFAULT false,
  pode_editar       BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(departamento_id, modulo)
);

-- Notificações
CREATE TABLE IF NOT EXISTS notification_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL UNIQUE,
  is_enabled      BOOLEAN DEFAULT true,
  email_enabled   BOOLEAN DEFAULT true,
  whatsapp_enabled BOOLEAN DEFAULT false,
  config          JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MARKETING
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_content (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL,  -- 'social' | 'digital' | 'print'
  categoria       TEXT,
  descricao       TEXT,
  storage_file_id UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  file_url        TEXT,
  thumbnail_url   TEXT,
  tags            TEXT[],
  is_active       BOOLEAN DEFAULT true,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_marketing_content_updated_at
  BEFORE UPDATE ON marketing_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Kits de marketing pessoal
CREATE TABLE IF NOT EXISTS marketing_pessoal_kits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  descricao   TEXT,
  cargo_ids   UUID[],
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_marketing_kits_updated_at
  BEFORE UPDATE ON marketing_pessoal_kits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS marketing_pessoal_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id          UUID REFERENCES marketing_pessoal_kits(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  descricao       TEXT,
  storage_file_id UUID REFERENCES storage_files(id) ON DELETE SET NULL,
  file_url        TEXT,
  thumbnail_url   TEXT,
  tipo            TEXT,
  ordem           INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_marketing_items_updated_at
  BEFORE UPDATE ON marketing_pessoal_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WEBSITE BUILDER
-- ============================================================

CREATE TABLE IF NOT EXISTS website_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  UUID REFERENCES organizacao_principal(id),
  config          JSONB DEFAULT '{}',
  pages           JSONB DEFAULT '[]',
  theme           JSONB DEFAULT '{}',
  is_published    BOOLEAN DEFAULT false,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_website_settings_updated_at
  BEFORE UPDATE ON website_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ESCALAS / EVENTOS (Coordenação)
-- ============================================================

CREATE TABLE IF NOT EXISTS eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  tipo            TEXT,
  data_inicio     TIMESTAMPTZ NOT NULL,
  data_fim        TIMESTAMPTZ,
  local           TEXT,
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  criado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  is_obrigatorio  BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_eventos_updated_at
  BEFORE UPDATE ON eventos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS evento_confirmacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  comercial_id    UUID REFERENCES comerciais(id) ON DELETE CASCADE,
  funcionario_id  UUID REFERENCES funcionarios(id) ON DELETE CASCADE,
  status          TEXT DEFAULT 'pendente',  -- 'pendente' | 'confirmado' | 'recusado'
  notas           TEXT,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PORTAL LEADS (sincronização de leads do portal 21online)
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_leads_sync (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id       TEXT NOT NULL UNIQUE,
  crm_workspace_id  TEXT,
  lead_contact_id   UUID REFERENCES lead_contacts(id) ON DELETE SET NULL,
  raw_payload       JSONB,
  synced_at         TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- IDRIVE E2 CONFIG (mantido para compatibilidade / migração)
-- ============================================================

CREATE TABLE IF NOT EXISTS idrive_e2_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_key_id       TEXT,
  secret_key_encrypted TEXT,
  endpoint            TEXT,
  region              TEXT DEFAULT 'us-east-1',
  is_configured       BOOLEAN DEFAULT false,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNÇÃO: Validar token de pedido de documentação
-- ============================================================

CREATE OR REPLACE FUNCTION validate_property_docs_token(p_token TEXT)
RETURNS TABLE(property_id UUID, referencia TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, referencia
  FROM properties
  WHERE docs_request_token = p_token
    AND docs_request_link_active = true
    AND (docs_request_link_generated_at IS NULL OR docs_request_link_generated_at > now() - interval '30 days');
$$;

CREATE OR REPLACE FUNCTION validate_processo_docs_token(p_token TEXT)
RETURNS TABLE(processo_id UUID, nome_cliente TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, nome_cliente
  FROM processos_credito
  WHERE docs_request_token = p_token
    AND docs_request_active = true;
$$;

-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
