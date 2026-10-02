-- Extended block freshness metadata (additive)

ALTER TABLE onec_clients
  ADD COLUMN IF NOT EXISTS extended_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extended_freshness_state TEXT;

ALTER TABLE onec_clients
  ADD CONSTRAINT onec_clients_extended_freshness_state_check
  CHECK (
    extended_freshness_state IS NULL
    OR extended_freshness_state IN ('current', 'preserved_from_previous', 'not_provided_in_snapshot')
  );
