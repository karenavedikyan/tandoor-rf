-- Tanbot Telegram stage2: account linking, webhook dedup, notification outbox (channel-agnostic core)

CREATE TABLE IF NOT EXISTS tanbot_telegram_link_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  telegram_user_id BIGINT,
  telegram_chat_id BIGINT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_started_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tanbot_link_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS tanbot_telegram_link_attempts_user_active_idx
  ON tanbot_telegram_link_attempts (user_id, created_at DESC)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS tanbot_telegram_accounts (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stopped_at TIMESTAMPTZ,
  CONSTRAINT tanbot_telegram_accounts_tg_user_uq UNIQUE (telegram_user_id),
  CONSTRAINT tanbot_telegram_accounts_tg_user_positive CHECK (telegram_user_id > 0),
  CONSTRAINT tanbot_telegram_accounts_chat_positive CHECK (telegram_chat_id > 0)
);

CREATE TABLE IF NOT EXISTS tanbot_telegram_update_dedup (
  update_id BIGINT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tanbot_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram')),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tanbot_notification_outbox_idempotency_uq UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS tanbot_notification_outbox_pending_idx
  ON tanbot_notification_outbox (next_attempt_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS tanbot_telegram_link_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON tanbot_telegram_link_attempts FROM PUBLIC;
REVOKE ALL ON tanbot_telegram_accounts FROM PUBLIC;
REVOKE ALL ON tanbot_telegram_update_dedup FROM PUBLIC;
REVOKE ALL ON tanbot_notification_outbox FROM PUBLIC;
REVOKE ALL ON tanbot_telegram_link_audit FROM PUBLIC;
