-- Retry/poll limits must reset when an edited post gets a new revision or a
-- new Meta container. `attempt_number` remains the monotonic audit sequence;
-- these columns provide a generation-local counter for safety decisions.
ALTER TABLE publish_attempts ADD COLUMN generation_key TEXT;
ALTER TABLE publish_attempts ADD COLUMN generation_attempt_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_publish_attempts_generation
  ON publish_attempts (content_id, operation, generation_key, generation_attempt_number DESC);
