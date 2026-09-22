-- Auth and profile schema for tandoor-rf (stage 2)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (
    role IN (
      'admin',
      'director',
      'rop',
      'regional_manager',
      'manager',
      'marketer',
      'analyst',
      'category_manager'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_email_not_blank CHECK (BTRIM(email) <> ''),
  CONSTRAINT users_email_normalized CHECK (email = LOWER(BTRIM(email))),
  CONSTRAINT users_password_hash_not_blank CHECK (BTRIM(password_hash) <> ''),
  CONSTRAINT users_full_name_trimmed CHECK (full_name = BTRIM(full_name)),
  CONSTRAINT users_full_name_len CHECK (char_length(full_name) >= 2 AND char_length(full_name) <= 200),
  CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+7\d{10}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uq ON users (LOWER(BTRIM(email)));

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_uq ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_active_expires_idx ON sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS login_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_rate_limits_locked_until_idx ON login_rate_limits (locked_until)
  WHERE locked_until IS NOT NULL;
