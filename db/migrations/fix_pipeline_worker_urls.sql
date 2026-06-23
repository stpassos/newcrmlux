-- Fix: update c21_pipelines.worker_url to use direct IPs instead of worker.century21lux.pt
-- Run on: psql -U postgres -d newcrmlux
--
-- The pipelines were activated with https://worker.century21lux.pt/... as the worker URL.
-- The IIS/ARR proxy at worker.century21lux.pt is unreachable, causing pipelineExecutor to fail.
-- This migration replaces with direct IP:port URLs that the API server can reach.

-- Preview first (safe to run without changes):
SELECT worker_name, worker_url FROM c21_pipelines ORDER BY worker_name;

-- Apply the fix:
UPDATE c21_pipelines
SET worker_url = 'http://173.249.49.92:8080', updated_at = NOW()
WHERE worker_name = 'WorkerLux-1';

UPDATE c21_pipelines
SET worker_url = 'http://173.249.49.92:8081', updated_at = NOW()
WHERE worker_name = 'WorkerLux-2';

UPDATE c21_pipelines
SET worker_url = 'http://173.249.49.92:8082', updated_at = NOW()
WHERE worker_name = 'WorkerLux-3';

UPDATE c21_pipelines
SET worker_url = 'http://173.249.49.92:8083', updated_at = NOW()
WHERE worker_name = 'WorkerLux-4';

-- Verify result:
SELECT worker_name, worker_url, status, is_active FROM c21_pipelines ORDER BY worker_name;
