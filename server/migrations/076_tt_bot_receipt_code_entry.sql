-- No receipt code or raw message is stored. One explicit, short-lived selection per private messenger chat.
CREATE TABLE IF NOT EXISTS tt_bot_receipt_code_entries (
  channel text NOT NULL CHECK (channel IN ('max','telegram')),
  messenger_chat_id text NOT NULL,
  messenger_user_id text NOT NULL,
  staff_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid REFERENCES tt_external_persons(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tt_parties(id) ON DELETE CASCADE,
  pending_party_id uuid NOT NULL REFERENCES tt_parties(id) ON DELETE CASCADE,
  transfer_id text NOT NULL REFERENCES tt_transfers(id) ON DELETE CASCADE,
  handoff_version integer NOT NULL CHECK (handoff_version > 0),
  expires_at timestamptz NOT NULL,
  CHECK ((staff_user_id IS NOT NULL)::integer + (person_id IS NOT NULL)::integer = 1),
  PRIMARY KEY (channel,messenger_chat_id)
);
