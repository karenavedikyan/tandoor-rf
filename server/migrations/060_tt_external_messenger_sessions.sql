-- External recipient messenger handoff (Telegram / MAX), separate from LK link tokens.
CREATE TABLE IF NOT EXISTS tt_external_messenger_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash BYTEA NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES tt_transfers(id) ON DELETE CASCADE,
  pending_party_id UUID NOT NULL REFERENCES tt_parties(id),
  handoff_version INT NOT NULL,
  channel TEXT CHECK (channel IS NULL OR channel IN ('telegram', 'max')),
  expires_at TIMESTAMPTZ NOT NULL,
  contact_attempt_count INT NOT NULL DEFAULT 0,
  code_issue_count INT NOT NULL DEFAULT 0,
  phone_verified_at TIMESTAMPTZ NULL,
  code_issued_at TIMESTAMPTZ NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_ext_msg_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS tt_ext_msg_sessions_transfer_idx
  ON tt_external_messenger_sessions (transfer_id, handoff_version)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS tt_ext_msg_sessions_pending_idx
  ON tt_external_messenger_sessions (pending_party_id)
  WHERE superseded_at IS NULL;
