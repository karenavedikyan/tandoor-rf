-- Bitrix24 task checklist snapshots (read-only cache)

CREATE TABLE IF NOT EXISTS bitrix24_task_checklist_snapshots (
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  object_type bitrix24_object_type,
  object_guid UUID,
  load_status TEXT NOT NULL
    CHECK (load_status IN ('loaded', 'empty', 'error', 'partial')),
  sync_complete BOOLEAN NOT NULL DEFAULT false,
  error_code VARCHAR(64),
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress_completed INTEGER,
  progress_total INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portal_id, task_id)
);

CREATE INDEX IF NOT EXISTS bitrix24_task_checklist_snapshots_object_idx
  ON bitrix24_task_checklist_snapshots (portal_id, object_type, object_guid)
  WHERE object_type IS NOT NULL AND object_guid IS NOT NULL;
