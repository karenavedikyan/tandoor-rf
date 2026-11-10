-- Additive. No plaintext codes, passwords, messenger payloads or credentials are persisted.
CREATE TABLE IF NOT EXISTS password_recovery_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  request_kind TEXT NOT NULL DEFAULT 'admin-issued'
    CHECK (request_kind IN ('admin-issued','employee-requested','admin-self')),
  channel TEXT NOT NULL CHECK (channel IN ('max','telegram')),
  messenger_user_id TEXT NOT NULL,
  messenger_chat_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL,
  code_hash TEXT,
  credential_fingerprint TEXT NOT NULL,
  recipient_fingerprint TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (code_hash IS NULL OR length(code_hash)=64)
);
CREATE INDEX IF NOT EXISTS password_recovery_challenges_user_idx
  ON password_recovery_challenges(user_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS password_recovery_challenges_one_pending
  ON password_recovery_challenges(user_id) WHERE used_at IS NULL AND cancelled_at IS NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS password_recovery_challenge_id UUID
  REFERENCES password_recovery_challenges(id) ON DELETE SET NULL;
