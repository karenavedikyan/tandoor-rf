-- Allow regular_update trigger source in client import journal.

ALTER TABLE onec_client_import_runs DROP CONSTRAINT IF EXISTS onec_client_import_runs_trigger_source_check;
ALTER TABLE onec_client_import_runs ADD CONSTRAINT onec_client_import_runs_trigger_source_check
  CHECK (trigger_source IS NULL OR trigger_source IN ('manual', 'scheduled', 'operator_job', 'regular_update'));
