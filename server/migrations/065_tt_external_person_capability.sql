-- Verified external identity (phone + own messenger contact) for «Мои передачи» capability.

CREATE TABLE IF NOT EXISTS tt_external_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  party_id UUID NOT NULL REFERENCES tt_parties (id) ON DELETE RESTRICT,
  access_epoch INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_external_persons_phone_format CHECK (phone_e164 ~ '^\+7\d{10}$'),
  CONSTRAINT tt_external_persons_name_trimmed CHECK (display_name = BTRIM(display_name))
);

CREATE UNIQUE INDEX IF NOT EXISTS tt_external_persons_phone_uq ON tt_external_persons (phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS tt_external_persons_party_uq ON tt_external_persons (party_id);

CREATE TABLE IF NOT EXISTS tt_external_person_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES tt_external_persons (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  messenger_user_id TEXT NOT NULL,
  messenger_chat_id TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_external_person_verifications_channel_user_uq UNIQUE (channel, messenger_user_id)
);

CREATE INDEX IF NOT EXISTS tt_external_person_verifications_person_idx
  ON tt_external_person_verifications (person_id);

CREATE TABLE IF NOT EXISTS tt_external_person_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash BYTEA NOT NULL,
  person_id UUID NOT NULL REFERENCES tt_external_persons (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_external_person_sessions_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS tt_external_person_sessions_person_active_idx
  ON tt_external_person_sessions (person_id)
  WHERE revoked_at IS NULL;
