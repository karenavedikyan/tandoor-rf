-- R2.2 fixes: timestamptz changed_at, object hierarchy for holding aggregation

ALTER TABLE bitrix24_task_cache
  ALTER COLUMN changed_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN changed_at IS NULL OR btrim(changed_at) = '' THEN NOW()
    WHEN changed_at ~ '^\d{4}-\d{2}-\d{2}T' THEN changed_at::timestamptz
    ELSE NOW()
  END;

CREATE TABLE IF NOT EXISTS bitrix24_object_hierarchy (
  parent_type bitrix24_object_type NOT NULL,
  parent_guid UUID NOT NULL,
  child_type bitrix24_object_type NOT NULL,
  child_guid UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_type, parent_guid, child_type, child_guid),
  CONSTRAINT bitrix24_object_hierarchy_holding_parent CHECK (parent_type = 'holding')
);

CREATE INDEX IF NOT EXISTS bitrix24_object_hierarchy_parent_idx
  ON bitrix24_object_hierarchy (parent_type, parent_guid);
