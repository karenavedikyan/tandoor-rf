-- R2.2 working mode: separate link verification from cache freshness; card sync cooldown

ALTER TABLE bitrix24_employee_portal_links
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

UPDATE bitrix24_employee_portal_links
SET last_verified_at = confirmed_at
WHERE last_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS bitrix24_manual_sync_card_cooldown (
  portal_id VARCHAR(255) NOT NULL,
  card_guid UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users (id),
  last_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portal_id, card_guid, user_id)
);

CREATE TABLE IF NOT EXISTS bitrix24_labels_bootstrap_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_mode VARCHAR(16) NOT NULL CHECK (run_mode IN ('dry_run', 'apply')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
