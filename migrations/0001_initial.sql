PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'threads')),
  platform_user_id TEXT NOT NULL,
  username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'revoked', 'error')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, platform_user_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  video_codec TEXT,
  audio_codec TEXT,
  drive_ref TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'validated', 'invalid', 'deleted')),
  validation_error TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  delete_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'multipart')),
  upload_id TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  aborted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'threads')),
  format TEXT NOT NULL CHECK (format IN ('reel', 'image', 'carousel', 'text', 'video')),
  scheduled_at TEXT,
  text TEXT NOT NULL DEFAULT '',
  topic_tag TEXT,
  location_id TEXT,
  share_to_feed INTEGER NOT NULL DEFAULT 1 CHECK (share_to_feed IN (0, 1)),
  late_policy TEXT NOT NULL DEFAULT 'publish_within_window' CHECK (late_policy IN ('publish_within_window', 'require_attention', 'skip')),
  late_window_minutes INTEGER NOT NULL DEFAULT 240,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft', 'validating', 'ready', 'scheduled', 'container_created', 'processing',
    'ready_to_publish', 'publishing', 'published', 'paused', 'retry_wait', 'delayed',
    'publish_unknown', 'needs_attention', 'failed', 'cancelled'
  )),
  resume_state TEXT,
  next_attempt_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  container_id TEXT,
  platform_media_id TEXT,
  permalink TEXT,
  last_error TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (external_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_content_due
  ON content_items (enabled, state, next_attempt_at, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_content_calendar
  ON content_items (scheduled_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_content_account
  ON content_items (account_id, state);

CREATE TABLE IF NOT EXISTS content_media (
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  alt_text TEXT,
  PRIMARY KEY (content_id, position),
  UNIQUE (content_id, media_id)
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (content_id, revision)
);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'succeeded', 'retry', 'failed', 'unknown')),
  http_status INTEGER,
  platform_code TEXT,
  error_message TEXT,
  request_id TEXT,
  response_excerpt TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (content_id, attempt_number, operation)
);

CREATE INDEX IF NOT EXISTS idx_publish_attempts_content
  ON publish_attempts (content_id, started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events (entity_type, entity_id, id DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'threads')),
  redirect_uri TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
VALUES ('global_pause', 'false', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  trigger_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'succeeded', 'partial', 'failed')),
  claimed_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cpu_ms REAL
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS notification_dedup (
  dedup_key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'monthly', 'manual')),
  record_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  confirmation_code TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'threads')),
  provider_user_id TEXT NOT NULL,
  status_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'not_found', 'failed')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);
