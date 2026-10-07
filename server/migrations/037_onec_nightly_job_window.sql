-- Nightly job execution window: key and deadline stored on the job row.

ALTER TABLE onec_import_jobs
  ADD COLUMN IF NOT EXISTS nightly_window_key TEXT;

ALTER TABLE onec_import_jobs
  ADD COLUMN IF NOT EXISTS nightly_window_deadline_at TIMESTAMPTZ;
