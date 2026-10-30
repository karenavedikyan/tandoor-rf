-- Phone-first contact dedupe audit (admin report, no automatic merge).

CREATE TABLE IF NOT EXISTS tt_phone_dedupe_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  party_ids UUID[] NOT NULL,
  kinds TEXT[] NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  note TEXT NULL,
  CONSTRAINT tt_phone_dedupe_conflicts_phone_uq UNIQUE (phone_e164)
);

CREATE INDEX IF NOT EXISTS tt_phone_dedupe_conflicts_open_idx
  ON tt_phone_dedupe_conflicts (detected_at DESC)
  WHERE resolved_at IS NULL;
