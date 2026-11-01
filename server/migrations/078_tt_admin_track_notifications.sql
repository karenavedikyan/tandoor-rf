-- Opt-in administrative creation notifications. No backfill, trigger or delivery job.
CREATE TABLE IF NOT EXISTS tt_admin_track_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'all', 'staff', 'external')),
  enabled_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
