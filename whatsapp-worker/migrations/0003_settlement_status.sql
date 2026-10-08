-- Existing v1.2-v1.3 entries corresponded to already-recorded transactions.
ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'settled' CHECK(status IN ('settled','pending'));
CREATE INDEX IF NOT EXISTS ix_transactions_owner_status ON transactions(wa_id,status);
