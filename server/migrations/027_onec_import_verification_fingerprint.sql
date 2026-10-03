-- Bind import apply to verified parameter set (clients + roster + policy + mode)

ALTER TABLE onec_client_import_runs
  ADD COLUMN IF NOT EXISTS verification_fingerprint CHAR(64);

COMMENT ON COLUMN onec_client_import_runs.verification_fingerprint IS
  'SHA-256 fingerprint of clientsSha256, holdingLinkValidationPolicy, employeeRosterSourceSha256, wholesaleCompositionMode';
