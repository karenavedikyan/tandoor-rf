-- Per-channel opt-out for external persons (independent of staff tanbot accounts).

ALTER TABLE tt_external_person_verifications
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tt_external_person_verifications
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS tt_external_person_verifications_active_notify_idx
  ON tt_external_person_verifications (person_id, channel)
  WHERE notifications_enabled = TRUE;
