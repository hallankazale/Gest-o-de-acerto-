-- D1 privacy boundary: WhatsApp ID identifies one owner's isolated data.
CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY, wa_id TEXT, linked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_devices_wa ON devices(wa_id);
CREATE TABLE IF NOT EXISTS link_codes (
  code_hash TEXT PRIMARY KEY, token_hash TEXT NOT NULL REFERENCES devices(token_hash),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_link_codes_device ON link_codes(token_hash);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, wa_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  cents INTEGER NOT NULL CHECK(cents > 0), title TEXT NOT NULL, category TEXT NOT NULL,
  occurred_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_message_id TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_transactions_owner ON transactions(wa_id,created_at,id);
CREATE TABLE IF NOT EXISTS pending (
  wa_id TEXT PRIMARY KEY, kind TEXT NOT NULL, cents INTEGER NOT NULL,
  title TEXT NOT NULL, category TEXT NOT NULL, occurred_on TEXT NOT NULL,
  source_message_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS received_events (
  id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Short-lived webhook queue enables retries without retaining raw audio files.
ALTER TABLE received_events ADD COLUMN sender TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_received_sender ON received_events(sender,received_at);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,sender TEXT NOT NULL,payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_inbox_status ON inbox(status,last_attempt);
