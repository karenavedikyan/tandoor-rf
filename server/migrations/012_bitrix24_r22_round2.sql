-- R2.2 round 2: binding diagnostics, label audit

CREATE TABLE IF NOT EXISTS bitrix24_label_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(32) NOT NULL,
  object_type bitrix24_object_type,
  object_guid UUID,
  label_code VARCHAR(12),
  actor_user_id UUID REFERENCES users (id),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bitrix24_binding_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  reason VARCHAR(32) NOT NULL,
  detail TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bitrix24_binding_diagnostics_portal_idx
  ON bitrix24_binding_diagnostics (portal_id, recorded_at DESC);
