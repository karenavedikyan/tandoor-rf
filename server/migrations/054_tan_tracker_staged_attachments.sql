-- Staged attachments (wizard) before/after transfer link

CREATE TABLE IF NOT EXISTS tt_staged_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tt_staged_attachments_owner_idx
  ON tt_staged_attachments (owner_user_id, created_at DESC)
  WHERE consumed_at IS NULL;
