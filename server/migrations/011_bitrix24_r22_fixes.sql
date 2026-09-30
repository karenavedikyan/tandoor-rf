-- R2.2 fixes: timestamptz changed_at, object hierarchy for holding aggregation

CREATE OR REPLACE FUNCTION bitrix24_safe_timestamptz(raw_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN
    RETURN NULL;
  END IF;
  IF raw_value !~ '^\d{4}-\d{2}-\d{2}T' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN raw_value::timestamptz;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
END;
$$;

ALTER TABLE bitrix24_task_cache
  ALTER COLUMN changed_at DROP NOT NULL;

ALTER TABLE bitrix24_task_cache
  ALTER COLUMN changed_at TYPE TIMESTAMPTZ
  USING bitrix24_safe_timestamptz(changed_at::text);

UPDATE bitrix24_task_cache
SET published = FALSE
WHERE changed_at IS NULL;

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

DROP FUNCTION IF EXISTS bitrix24_safe_timestamptz(TEXT);
