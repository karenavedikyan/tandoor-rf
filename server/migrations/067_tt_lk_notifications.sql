-- In-app LK notifications (independent of messenger outbox delivery).

CREATE TABLE IF NOT EXISTS tt_lk_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transfer_id TEXT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_lk_notifications_idempotency_uq UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS tt_lk_notifications_user_unread_idx
  ON tt_lk_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
