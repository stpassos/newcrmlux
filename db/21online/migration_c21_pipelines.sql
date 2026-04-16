-- Migration: c21_pipelines, c21_pipeline_endpoints, c21_pipeline_jobs
-- Run with: psql -U postgres -d newcrmlux -f migration_c21_pipelines.sql

-- ─── c21_pipelines ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS c21_pipelines (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name   TEXT        NOT NULL UNIQUE,  -- e.g. 'WorkerLux-1'
  worker_url    TEXT        NOT NULL,
  interval_min  INTEGER     NOT NULL DEFAULT 5,
  interval_max  INTEGER     NOT NULL DEFAULT 15,
  status        TEXT        NOT NULL DEFAULT 'not_configured'
                            CHECK (status IN ('not_configured','ready','running','stopped','error')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  started_at    TIMESTAMPTZ,
  stopped_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── c21_pipeline_endpoints ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS c21_pipeline_endpoints (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id         UUID        NOT NULL REFERENCES c21_pipelines(id) ON DELETE CASCADE,
  sort_order          INTEGER     NOT NULL DEFAULT 0,
  endpoint_name       TEXT        NOT NULL,
  endpoint_path       TEXT        NOT NULL,
  workspace_id        TEXT,
  workspace_name      TEXT,
  credential_id       UUID        REFERENCES c21_credentials(id) ON DELETE SET NULL,
  active_from         TIME,
  active_to           TIME,
  active_days         INTEGER[]   NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  backfill_mode       TEXT        NOT NULL DEFAULT 'full'
                                  CHECK (backfill_mode IN ('full','from_date')),
  backfill_from_date  DATE,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  status              TEXT        NOT NULL DEFAULT 'idle'
                                  CHECK (status IN ('idle','running','done','error','waiting')),
  last_run_at         TIMESTAMPTZ,
  last_fetched        INTEGER     NOT NULL DEFAULT 0,
  last_inserted       INTEGER     NOT NULL DEFAULT 0,
  last_skipped        INTEGER     NOT NULL DEFAULT 0,
  last_failed         INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_endpoints_pipeline_id
  ON c21_pipeline_endpoints(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_endpoints_sort
  ON c21_pipeline_endpoints(pipeline_id, sort_order);

-- ─── c21_pipeline_jobs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS c21_pipeline_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   UUID        NOT NULL REFERENCES c21_pipelines(id) ON DELETE CASCADE,
  endpoint_id   UUID        REFERENCES c21_pipeline_endpoints(id) ON DELETE SET NULL,
  workspace_id  TEXT,
  workspace_name TEXT,
  credential_id UUID        REFERENCES c21_credentials(id) ON DELETE SET NULL,
  entity        TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running','done','error','cancelled')),
  progress      INTEGER     NOT NULL DEFAULT 0,
  fetched       INTEGER     NOT NULL DEFAULT 0,
  inserted      INTEGER     NOT NULL DEFAULT 0,
  skipped       INTEGER     NOT NULL DEFAULT 0,
  failed        INTEGER     NOT NULL DEFAULT 0,
  error_msg     TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pipeline_id
  ON c21_pipeline_jobs(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_started_at
  ON c21_pipeline_jobs(started_at DESC);

-- ─── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_c21_pipelines'
  ) THEN
    CREATE TRIGGER set_updated_at_c21_pipelines
      BEFORE UPDATE ON c21_pipelines
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_c21_pipeline_endpoints'
  ) THEN
    CREATE TRIGGER set_updated_at_c21_pipeline_endpoints
      BEFORE UPDATE ON c21_pipeline_endpoints
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
