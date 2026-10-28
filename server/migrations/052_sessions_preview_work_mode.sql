-- Admin preview: optional work mode (mutating business actions with audit). Read-only remains default.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS preview_work_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preview_work_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preview_work_expires_at TIMESTAMPTZ;
