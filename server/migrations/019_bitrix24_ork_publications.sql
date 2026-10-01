-- R2.4: distinguish #орк sync publications from admin-seeded summaries

ALTER TABLE bitrix24_task_summary_publications
  ADD COLUMN IF NOT EXISTS publication_origin TEXT NOT NULL DEFAULT 'admin'
    CHECK (publication_origin IN ('admin', 'ork_sync')),
  ADD COLUMN IF NOT EXISTS task_cache_version INTEGER;

CREATE INDEX IF NOT EXISTS bitrix24_task_summary_publications_ork_idx
  ON bitrix24_task_summary_publications (portal_id, task_id, publication_origin)
  WHERE revoked_at IS NULL;
