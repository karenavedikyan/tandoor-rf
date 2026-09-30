CREATE TABLE IF NOT EXISTS bitrix24_manual_sync_cooldown (
  portal_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  last_started_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (portal_id, task_id)
);
