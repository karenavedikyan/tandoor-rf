-- Idempotent external request confirm mapping (idempotency_key != transfer id).

ALTER TABLE tt_external_request_drafts
  ADD COLUMN IF NOT EXISTS confirmed_transfer_id TEXT NULL REFERENCES tt_transfers (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tt_external_request_drafts_idempotency_uq
  ON tt_external_request_drafts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tt_external_person_message_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES tt_external_persons (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  messenger_chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_external_person_message_outbox_idempotency_uq UNIQUE (idempotency_key)
);
