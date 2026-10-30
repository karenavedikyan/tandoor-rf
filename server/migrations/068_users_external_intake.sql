-- Staff flag: may receive external-origin transfer requests (admin-managed, not director-by-default).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS accepts_external_tt_intake BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_accepts_external_tt_intake_idx
  ON users (id)
  WHERE accepts_external_tt_intake = TRUE AND status = 'active';
