-- Admin read-only employee preview (session-scoped, per-session)

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS preview_user_id UUID NULL REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_preview_user_id_idx ON sessions (preview_user_id)
  WHERE preview_user_id IS NOT NULL;
