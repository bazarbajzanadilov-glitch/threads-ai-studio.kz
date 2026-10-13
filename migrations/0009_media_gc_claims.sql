-- Durable media garbage-collection claims close the SELECT -> R2 delete race.
-- The trigger is the final CAS boundary: content linking cannot sneak in after
-- application-level media validation but before a claimed object is removed.
CREATE TABLE IF NOT EXISTS media_gc_claims (
  media_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('upload_expired', 'media_cleanup')),
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_gc_claim_token
  ON media_gc_claims (claim_token, reason, claimed_at);

CREATE TRIGGER IF NOT EXISTS trg_content_media_reject_gc_claim
BEFORE INSERT ON content_media
WHEN EXISTS (SELECT 1 FROM media_gc_claims WHERE media_id = NEW.media_id)
BEGIN
  SELECT RAISE(ABORT, 'MEDIA_GC_CLAIMED');
END;
