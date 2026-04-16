-- ============================================================
-- Migration: LUX Server Monitor
-- Tabelas de métricas do servidor Linux (VPS-LUX 173.249.49.92)
-- ============================================================

-- Snapshots do servidor a cada 15s
CREATE TABLE IF NOT EXISTS lux_server_metrics (
  id            BIGSERIAL    PRIMARY KEY,
  collected_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  server_ip     TEXT         NOT NULL DEFAULT '',
  cpu_pct       FLOAT        NOT NULL DEFAULT 0,
  ram_used_mb   INTEGER      NOT NULL DEFAULT 0,
  ram_total_mb  INTEGER      NOT NULL DEFAULT 0,
  disk_used_gb  FLOAT        NOT NULL DEFAULT 0,
  disk_total_gb FLOAT        NOT NULL DEFAULT 0,
  net_rx_kbps   FLOAT        NOT NULL DEFAULT 0,
  net_tx_kbps   FLOAT        NOT NULL DEFAULT 0,
  load_1        FLOAT        NOT NULL DEFAULT 0,
  load_5        FLOAT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lux_server_metrics_collected
  ON lux_server_metrics(collected_at DESC);

-- Métricas por worker PM2 a cada 15s
CREATE TABLE IF NOT EXISTS lux_worker_metrics (
  id            BIGSERIAL    PRIMARY KEY,
  collected_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  worker_name   TEXT         NOT NULL,
  pm2_status    TEXT         NOT NULL DEFAULT 'unknown',
  pm2_pid       INTEGER,
  cpu_pct       FLOAT        NOT NULL DEFAULT 0,
  ram_mb        FLOAT        NOT NULL DEFAULT 0,
  restarts      INTEGER      NOT NULL DEFAULT 0,
  uptime_ms     BIGINT       NOT NULL DEFAULT 0,
  active_jobs   INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lux_worker_metrics_collected
  ON lux_worker_metrics(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_lux_worker_metrics_name
  ON lux_worker_metrics(worker_name, collected_at DESC);

-- Log de jobs (enviado pelo agente quando muda estado)
CREATE TABLE IF NOT EXISTS lux_job_log (
  id             BIGSERIAL    PRIMARY KEY,
  logged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  worker_name    TEXT         NOT NULL DEFAULT '',
  job_id         TEXT,
  entity         TEXT,
  workspace_name TEXT,
  status         TEXT         NOT NULL,   -- started | completed | failed | paused
  duration_ms    INTEGER,
  fetched        INTEGER      NOT NULL DEFAULT 0,
  inserted       INTEGER      NOT NULL DEFAULT 0,
  error_msg      TEXT
);

CREATE INDEX IF NOT EXISTS idx_lux_job_log_logged
  ON lux_job_log(logged_at DESC);
