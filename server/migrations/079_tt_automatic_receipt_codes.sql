CREATE TABLE IF NOT EXISTS tt_automatic_receipt_codes (
  id uuid PRIMARY KEY,
  transfer_id text NOT NULL REFERENCES tt_transfers(id) ON DELETE CASCADE,
  handoff_version integer NOT NULL CHECK (handoff_version > 0),
  pending_party_id uuid NOT NULL REFERENCES tt_parties(id),
  channel text NOT NULL CHECK (channel IN ('telegram','max')),
  messenger_user_id text NOT NULL,
  messenger_chat_id text NOT NULL,
  phone_snapshot text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 3),
  encrypted_code text,
  code_hash text,
  code_expires_at timestamptz,
  header_sent_at timestamptz,
  sent_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_id,handoff_version)
);
CREATE INDEX IF NOT EXISTS tt_automatic_receipt_codes_pending_idx
  ON tt_automatic_receipt_codes(channel,next_attempt_at) WHERE status='pending';
