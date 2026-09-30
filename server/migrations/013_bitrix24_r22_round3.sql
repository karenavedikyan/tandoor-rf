-- R2.2 round 3: card object mapping, label exhaustion, snapshot fingerprints

CREATE TABLE IF NOT EXISTS bitrix24_client_card_objects (
  card_guid UUID PRIMARY KEY,
  object_type bitrix24_object_type NOT NULL,
  object_guid UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bitrix24_client_card_objects_object_idx
  ON bitrix24_client_card_objects (object_type, object_guid);

ALTER TABLE bitrix24_label_sequences
  ADD COLUMN IF NOT EXISTS exhausted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bitrix24_task_cache
  ADD COLUMN IF NOT EXISTS content_fingerprint CHAR(64);

ALTER TABLE bitrix24_task_bindings
  ADD COLUMN IF NOT EXISTS content_fingerprint CHAR(64);

CREATE INDEX IF NOT EXISTS bitrix24_sync_journal_scope_started_idx
  ON bitrix24_sync_journal (scope_summary, started_at DESC);
