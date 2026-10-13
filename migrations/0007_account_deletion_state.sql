-- Two-phase account deletion. `deleting` is deliberately a real account
-- state: scheduler/content paths can fail closed while an in-flight publish is
-- reconciled before account-scoped data is purged.
CREATE TABLE platform_accounts_deletion_v2 (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'threads')),
  platform_user_id TEXT NOT NULL,
  username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'revoked', 'error', 'deleting')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, platform_user_id)
);

INSERT INTO platform_accounts_deletion_v2
SELECT id, platform, platform_user_id, username, access_token_encrypted,
       refresh_token_encrypted, token_expires_at, scopes_json, status,
       last_error, created_at, updated_at
  FROM platform_accounts;

DROP TABLE platform_accounts;
ALTER TABLE platform_accounts_deletion_v2 RENAME TO platform_accounts;

ALTER TABLE deletion_requests ADD COLUMN provider_user_hash TEXT;
ALTER TABLE deletion_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'meta'
  CHECK (source IN ('meta', 'owner'));
ALTER TABLE deletion_requests ADD COLUMN account_id TEXT;
ALTER TABLE deletion_requests ADD COLUMN account_generation TEXT;
ALTER TABLE deletion_requests ADD COLUMN purged_at TEXT;
ALTER TABLE deletion_requests ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deletion_requests ADD COLUMN last_attempt_at TEXT;
ALTER TABLE deletion_requests ADD COLUMN updated_at TEXT;
ALTER TABLE deletion_requests ADD COLUMN deleted_media_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_deletion_request_digest
  ON deletion_requests (request_digest) WHERE request_digest IS NOT NULL;
CREATE INDEX idx_deletion_pending
  ON deletion_requests (status, requested_at);
CREATE INDEX idx_deletion_provider_hash
  ON deletion_requests (provider, provider_user_hash, status);

CREATE TABLE deletion_request_media (
  account_id TEXT NOT NULL,
  account_generation TEXT NOT NULL,
  media_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, account_generation, media_id)
);
