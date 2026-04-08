ALTER TABLE crm_connections
  ADD COLUMN IF NOT EXISTS crm_password TEXT;
