-- R2.2: Bitrix24 client label registry, task cache, bindings (local pilot)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bitrix24_object_type') THEN
    CREATE TYPE bitrix24_object_type AS ENUM ('holding', 'legal_entity', 'outlet');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bitrix24_label_sequences (
  object_type bitrix24_object_type PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
    CHECK (next_value >= 1 AND next_value <= 999999)
);

INSERT INTO bitrix24_label_sequences (object_type, next_value)
VALUES ('holding', 1), ('legal_entity', 1), ('outlet', 1)
ON CONFLICT (object_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS bitrix24_confirmed_objects (
  object_type bitrix24_object_type NOT NULL,
  object_guid UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by UUID REFERENCES users (id),
  PRIMARY KEY (object_type, object_guid)
);

CREATE TABLE IF NOT EXISTS bitrix24_object_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type bitrix24_object_type NOT NULL,
  object_guid UUID NOT NULL,
  label_code VARCHAR(12) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT bitrix24_object_labels_code_format CHECK (
    label_code ~ '^LK_(H|J|T)_[0-9]{6}$'
    AND label_code NOT LIKE '%_000000'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bitrix24_object_labels_code_active_idx
  ON bitrix24_object_labels (label_code)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bitrix24_object_labels_object_active_idx
  ON bitrix24_object_labels (object_type, object_guid)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS bitrix24_employee_portal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  portal_id VARCHAR(255) NOT NULL,
  bitrix_user_id VARCHAR(64) NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_expires_at TIMESTAMPTZ,
  CONSTRAINT bitrix24_employee_portal_links_user_portal_unique UNIQUE (user_id, portal_id)
);

CREATE TABLE IF NOT EXISTS bitrix24_task_cache (
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  responsible_bitrix_user_id VARCHAR(64),
  title TEXT NOT NULL,
  status_label VARCHAR(32) NOT NULL,
  deadline TEXT,
  changed_at TEXT NOT NULL,
  description_hash CHAR(64) NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_version BIGINT NOT NULL DEFAULT 1,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (portal_id, task_id)
);

CREATE TABLE IF NOT EXISTS bitrix24_task_bindings (
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  object_type bitrix24_object_type,
  object_guid UUID,
  label_code VARCHAR(12),
  binding_status VARCHAR(32) NOT NULL,
  conflict_reason TEXT,
  linked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portal_id, task_id)
);

CREATE INDEX IF NOT EXISTS bitrix24_task_bindings_object_idx
  ON bitrix24_task_bindings (object_type, object_guid)
  WHERE binding_status = 'confirmed';

CREATE TABLE IF NOT EXISTS bitrix24_sync_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_mode VARCHAR(16) NOT NULL CHECK (run_mode IN ('dry_run', 'apply')),
  scope_summary TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
