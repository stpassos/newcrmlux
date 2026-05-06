-- Migration: incremental_hours + full_backfill_time per endpoint
-- Run with: psql -U postgres -d newcrmlux -f migration_incremental_backfill.sql

-- New columns on c21_pipeline_endpoints
ALTER TABLE c21_pipeline_endpoints
  ADD COLUMN IF NOT EXISTS incremental_hours     INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS full_backfill_time    TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS full_backfill_last_date DATE  DEFAULT NULL;

-- job_type on c21_pipeline_jobs to distinguish full vs incremental runs
ALTER TABLE c21_pipeline_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'incremental';

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_type
  ON c21_pipeline_jobs(endpoint_id, job_type, started_at DESC);
