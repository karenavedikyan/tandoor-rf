-- R1.5 review: journal warnings truncation flag

ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS warnings_truncated BOOLEAN NOT NULL DEFAULT false;
