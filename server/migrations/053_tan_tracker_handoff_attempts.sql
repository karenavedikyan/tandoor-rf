-- Handoff code verify attempt counter (tt56: max 5 attempts per active code)

ALTER TABLE tt_handoff_codes
  ADD COLUMN IF NOT EXISTS verify_attempt_count INTEGER NOT NULL DEFAULT 0;
