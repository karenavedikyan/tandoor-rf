-- Delivery state for external-person messenger outbox (processed by tanbot outbox workers).

ALTER TABLE tt_external_person_message_outbox
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE tt_external_person_message_outbox
  DROP CONSTRAINT IF EXISTS tt_external_person_message_outbox_status_chk;

ALTER TABLE tt_external_person_message_outbox
  ADD CONSTRAINT tt_external_person_message_outbox_status_chk CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')
  );

CREATE INDEX IF NOT EXISTS tt_external_person_message_outbox_pending_idx
  ON tt_external_person_message_outbox (channel, next_attempt_at)
  WHERE status IN ('pending', 'processing');
