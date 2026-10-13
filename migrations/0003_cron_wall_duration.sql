-- `performance.now()` around an async Worker invocation measures elapsed wall
-- time (including D1/HTTP waits), not isolate CPU. Keep `cpu_ms` nullable for
-- values supplied by Cloudflare telemetry and store the locally measured value
-- under an unambiguous name.
ALTER TABLE cron_runs ADD COLUMN wall_duration_ms REAL;
