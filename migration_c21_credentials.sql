-- ============================================================
-- Migration: tabela c21_credentials
-- Credenciais 21online.app para importação via WorkersLux
-- ============================================================

CREATE TABLE IF NOT EXISTS c21_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  crm_password    TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_tested_at  TIMESTAMPTZ,
  test_status     TEXT,        -- 'success' | 'error' | null
  test_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_c21_credentials_updated_at
  BEFORE UPDATE ON c21_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_c21_credentials_active ON c21_credentials(is_active);
