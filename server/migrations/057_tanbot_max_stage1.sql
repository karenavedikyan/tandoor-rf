-- Tanbot MAX stage1: account linking, webhook dedup, audit (Telegram tables unchanged)

CREATE TABLE IF NOT EXISTS tanbot_max_link_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  max_user_id BIGINT,
  max_chat_id BIGINT,
  max_username TEXT,
  max_first_name TEXT,
  max_started_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tanbot_max_link_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS tanbot_max_link_attempts_user_active_idx
  ON tanbot_max_link_attempts (user_id, created_at DESC)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS tanbot_max_accounts (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  max_user_id BIGINT NOT NULL,
  max_chat_id BIGINT NOT NULL,
  max_username TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stopped_at TIMESTAMPTZ,
  CONSTRAINT tanbot_max_accounts_max_user_uq UNIQUE (max_user_id),
  CONSTRAINT tanbot_max_accounts_max_user_positive CHECK (max_user_id > 0),
  CONSTRAINT tanbot_max_accounts_chat_positive CHECK (max_chat_id > 0)
);

CREATE TABLE IF NOT EXISTS tanbot_max_update_dedup (
  dedup_key CHAR(64) PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'committed', 'failed')),
  reply_chat_id BIGINT,
  reply_user_id BIGINT,
  reply_text TEXT,
  reply_delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tanbot_max_link_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tanbot_notification_outbox DROP CONSTRAINT IF EXISTS tanbot_notification_outbox_channel_check;
ALTER TABLE tanbot_notification_outbox
  ADD CONSTRAINT tanbot_notification_outbox_channel_check
  CHECK (channel IN ('telegram', 'max'));

REVOKE ALL ON tanbot_max_link_attempts FROM PUBLIC;
REVOKE ALL ON tanbot_max_accounts FROM PUBLIC;
REVOKE ALL ON tanbot_max_update_dedup FROM PUBLIC;
REVOKE ALL ON tanbot_max_link_audit FROM PUBLIC;
