-- Link checklist snapshots to the accepted task cache generation.

ALTER TABLE bitrix24_task_checklist_snapshots
  ADD COLUMN IF NOT EXISTS task_cache_version INTEGER,
  ADD COLUMN IF NOT EXISTS task_synced_at TIMESTAMPTZ;
