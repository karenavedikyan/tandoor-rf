-- Clean-start lifecycle markers (exchange v3).

ALTER TABLE onec_v3_exchange_state
  ADD COLUMN IF NOT EXISTS legacy_clean_start_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legacy_clean_start_bundle_fingerprint CHAR(64);
