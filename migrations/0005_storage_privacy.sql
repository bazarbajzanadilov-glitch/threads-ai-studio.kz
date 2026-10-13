-- Account-wide R2 hard limit and accurate snapshot accounting.
ALTER TABLE snapshots ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
VALUES ('storage_limit_bytes', '10000000000', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
SELECT 'storage_reserved_bytes',
       CAST(
         COALESCE((SELECT SUM(size_bytes) FROM media_assets WHERE status <> 'deleted'), 0) +
         COALESCE((SELECT SUM(size_bytes) FROM snapshots), 0)
       AS TEXT),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
VALUES ('privacy_epoch', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO settings (key, value_json, updated_at)
VALUES ('privacy_deletion_in_progress', 'false', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Bind a Meta deletion callback to the exact fresh signed_request. The public
-- Worker verifies HMAC/freshness; the API uses these fields to prevent a replay
-- from deleting a later OAuth account generation.
ALTER TABLE deletion_requests ADD COLUMN request_digest TEXT;
ALTER TABLE deletion_requests ADD COLUMN issued_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_media_cleanup
  ON media_assets (status, delete_after, updated_at);
