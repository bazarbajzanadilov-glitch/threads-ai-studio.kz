-- Resumable, CPU-bounded snapshot jobs. Source tables are copied in pages of
-- at most 50 rows into immutable R2 shards; the published snapshot is a small
-- manifest that references those shards.
CREATE TABLE IF NOT EXISTS snapshot_jobs (
  id TEXT PRIMARY KEY,
  target_date TEXT NOT NULL UNIQUE,
  privacy_epoch INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'waiting_privacy', 'freezing', 'content', 'media', 'content_media', 'account', 'finalize',
    'completed', 'aborting', 'aborted', 'retiring'
  )),
  cursor_id TEXT,
  cursor_position INTEGER,
  next_shard_index INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  shard_bytes INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_jobs_work
  ON snapshot_jobs (stage, lease_expires_at, updated_at);

-- Immutable point-in-time source for an in-progress snapshot. One D1 batch
-- fills all four logical tables in a single transaction; later minute slices
-- only page these pre-rendered, token-free JSON records.
CREATE TABLE IF NOT EXISTS snapshot_source_rows (
  job_id TEXT NOT NULL REFERENCES snapshot_jobs(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL CHECK (table_name IN ('content', 'media', 'content_media', 'account')),
  cursor_key TEXT NOT NULL,
  cursor_position INTEGER NOT NULL DEFAULT 0,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (job_id, table_name, cursor_key, cursor_position)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_source_page
  ON snapshot_source_rows (job_id, table_name, cursor_key, cursor_position);

CREATE TABLE IF NOT EXISTS snapshot_shards (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES snapshot_jobs(id) ON DELETE CASCADE,
  shard_index INTEGER NOT NULL,
  table_name TEXT NOT NULL CHECK (table_name IN ('content', 'media', 'content_media', 'account')),
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  record_count INTEGER NOT NULL CHECK (record_count > 0 AND record_count <= 50),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  end_cursor_id TEXT,
  end_cursor_position INTEGER,
  delete_token TEXT,
  delete_claimed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, shard_index)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_shards_job
  ON snapshot_shards (job_id, shard_index);
CREATE INDEX IF NOT EXISTS idx_snapshot_shards_delete
  ON snapshot_shards (delete_token, delete_claimed_at);

-- Bridges the two external side effects required for every snapshot object:
-- the D1 storage reservation and the R2 PUT. The intent is created in the
-- same transaction as the counter increment, then removed only when the
-- immutable shard/manifest row is committed or the object is safely deleted.
CREATE TABLE IF NOT EXISTS snapshot_object_intents (
  r2_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  reservation_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_object_intents_job
  ON snapshot_object_intents (job_id, created_at);

-- Privacy deletion may discover an R2 object that has no durable manifest or
-- shard row (for example after an ambiguous D1 response).  Keeping the object
-- and its size here makes the bounded purge resumable and makes storage release
-- exact even if R2 deletion succeeds immediately before a Worker interruption.
CREATE TABLE IF NOT EXISTS snapshot_purge_objects (
  r2_key TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

ALTER TABLE snapshots ADD COLUMN job_id TEXT;
ALTER TABLE snapshots ADD COLUMN delete_token TEXT;
ALTER TABLE snapshots ADD COLUMN delete_claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_snapshots_job ON snapshots (job_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_delete
  ON snapshots (delete_token, delete_claimed_at);

-- One durable maintenance phase is executed per eligible Cron invocation.
-- Snapshot paging, retention, token refresh and the daily summary therefore
-- never share a Free-plan 10 ms CPU budget.
CREATE TABLE IF NOT EXISTS daily_maintenance_jobs (
  id TEXT PRIMARY KEY,
  target_date TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL CHECK (stage IN (
    'cleanup', 'snapshot', 'retention', 'deletions', 'tokens', 'summary', 'completed'
  )),
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_maintenance_work
  ON daily_maintenance_jobs (stage, lease_expires_at, created_at);
