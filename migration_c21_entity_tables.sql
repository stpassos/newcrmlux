-- Migration: create c21_* entity tables for imported data storage
-- Each table stores raw records from 21online.app as JSONB

CREATE TABLE IF NOT EXISTS c21_agents (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_contacts (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_assets (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_owners (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_buyers (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_transactions (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_referrals (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_visits (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_proposals (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_documents (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_awards (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS c21_workspaces (
  id          SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  workspace_id TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_c21_agents_workspace      ON c21_agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_contacts_workspace    ON c21_contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_assets_workspace      ON c21_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_owners_workspace      ON c21_owners(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_buyers_workspace      ON c21_buyers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_transactions_workspace ON c21_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_referrals_workspace   ON c21_referrals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_visits_workspace      ON c21_visits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_proposals_workspace   ON c21_proposals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_documents_workspace   ON c21_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_c21_awards_workspace      ON c21_awards(workspace_id);

\echo 'c21_* entity tables created successfully'
