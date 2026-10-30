-- External-origin request drafts (bot conversation) and decline metadata on transfers.

CREATE TABLE IF NOT EXISTS tt_external_request_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES tt_external_persons (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  messenger_chat_id TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT 'item',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_external_request_drafts_channel_chat_uq UNIQUE (channel, messenger_chat_id)
);

CREATE TABLE IF NOT EXISTS tt_external_request_draft_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES tt_external_request_drafts (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  telegram_file_id TEXT NULL,
  max_file_token TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_external_request_draft_files_draft_idx
  ON tt_external_request_draft_files (draft_id);

ALTER TABLE tt_transfers
  ADD COLUMN IF NOT EXISTS external_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_decline_reason TEXT;
