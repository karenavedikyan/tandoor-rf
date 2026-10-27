-- Additive: independent feedback closure never changes delegation access/status.
CREATE TABLE IF NOT EXISTS assistant_assignment_reviews (
  delegation_id UUID PRIMARY KEY REFERENCES delegations(id) ON DELETE CASCADE,
  manager_user_id UUID NOT NULL REFERENCES users(id),
  assistant_user_id UUID NOT NULL REFERENCES users(id),
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 10 AND 2000),
  worked_starts_at TIMESTAMPTZ NOT NULL,
  worked_ends_at TIMESTAMPTZ NOT NULL,
  snapshot JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (worked_starts_at < worked_ends_at)
);
CREATE INDEX IF NOT EXISTS assistant_reviews_manager_idx
  ON assistant_assignment_reviews(manager_user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS assistant_reviews_assistant_idx
  ON assistant_assignment_reviews(assistant_user_id, submitted_at DESC);
