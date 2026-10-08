-- Extend v1.2 without replacing the existing database or losing prior transactions.
-- Only normalized, human-approved draft items are stored, never raw audio or transcripts.
CREATE TABLE IF NOT EXISTS pending_batches (
  wa_id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL,
  items_json TEXT NOT NULL CHECK(length(items_json) <= 12000),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pending_batches_expires ON pending_batches(expires_at);
