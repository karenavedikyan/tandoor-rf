-- Persist holding/manager roster metadata independently of extended snapshot publication

ALTER TABLE onec_clients
  ADD COLUMN IF NOT EXISTS holding_link_state TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS guid_holding_pending UUID,
  ADD COLUMN IF NOT EXISTS manager_roster_state TEXT NOT NULL DEFAULT 'roster_not_loaded';

ALTER TABLE onec_clients
  DROP CONSTRAINT IF EXISTS onec_clients_holding_link_state_check;
ALTER TABLE onec_clients
  ADD CONSTRAINT onec_clients_holding_link_state_check
  CHECK (holding_link_state IN ('none', 'resolved', 'unresolved'));

ALTER TABLE onec_clients
  DROP CONSTRAINT IF EXISTS onec_clients_manager_roster_state_check;
ALTER TABLE onec_clients
  ADD CONSTRAINT onec_clients_manager_roster_state_check
  CHECK (
    manager_roster_state IN (
      'roster_not_loaded',
      'in_wholesale_roster',
      'outside_wholesale_roster'
    )
  );

CREATE INDEX IF NOT EXISTS onec_clients_manager_roster_state_idx
  ON onec_clients (manager_roster_state);

ALTER TABLE onec_import_jobs
  ADD COLUMN IF NOT EXISTS holding_link_validation_policy TEXT NOT NULL DEFAULT 'tolerant',
  ADD COLUMN IF NOT EXISTS employee_roster_source_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_composition_mode TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_holding_link_policy_check;
ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_holding_link_policy_check
  CHECK (holding_link_validation_policy IN ('tolerant', 'strict'));

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_wholesale_mode_check;
ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_wholesale_mode_check
  CHECK (wholesale_composition_mode IN ('standard', 'replacement_prep'));
