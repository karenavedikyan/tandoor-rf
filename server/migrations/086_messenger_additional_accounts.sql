-- Additive: retain original primary bindings, history and old-version contracts.
ALTER TABLE tanbot_max_accounts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE tanbot_max_accounts ADD COLUMN IF NOT EXISTS phone_confirmed_at TIMESTAMPTZ;
ALTER TABLE tanbot_telegram_accounts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE tanbot_telegram_accounts ADD COLUMN IF NOT EXISTS phone_confirmed_at TIMESTAMPTZ;

CREATE TABLE tanbot_max_additional_accounts (
  LIKE tanbot_max_accounts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  PRIMARY KEY (max_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX ON tanbot_max_additional_accounts(user_id);
CREATE TABLE tanbot_telegram_additional_accounts (
  LIKE tanbot_telegram_accounts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  PRIMARY KEY (telegram_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX ON tanbot_telegram_additional_accounts(user_id);

CREATE VIEW tanbot_max_all_accounts AS
  SELECT *, TRUE AS is_primary FROM tanbot_max_accounts
  UNION ALL
  SELECT *, FALSE AS is_primary FROM tanbot_max_additional_accounts;
CREATE VIEW tanbot_telegram_all_accounts AS
  SELECT *, TRUE AS is_primary FROM tanbot_telegram_accounts
  UNION ALL
  SELECT *, FALSE AS is_primary FROM tanbot_telegram_additional_accounts;

ALTER TABLE tanbot_max_link_attempts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE tanbot_max_link_attempts ADD COLUMN IF NOT EXISTS enable_notifications BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tanbot_telegram_link_attempts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE tanbot_telegram_link_attempts ADD COLUMN IF NOT EXISTS enable_notifications BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tanbot_notification_outbox ADD COLUMN IF NOT EXISTS target_messenger_user_id BIGINT;

REVOKE ALL ON tanbot_max_additional_accounts, tanbot_telegram_additional_accounts,
  tanbot_max_all_accounts, tanbot_telegram_all_accounts FROM PUBLIC;

-- One parent code per transfer leg; independent frozen account deliveries.
-- Existing queued parent rows are intentionally NOT backfilled.
ALTER TABLE tt_automatic_receipt_codes ADD COLUMN delivery_epoch UUID;
CREATE TABLE tt_automatic_receipt_account_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES tt_automatic_receipt_codes(id) ON DELETE CASCADE,
  delivery_epoch UUID NOT NULL,
  generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 3),
  channel TEXT NOT NULL CHECK (channel IN ('max','telegram')),
  messenger_user_id TEXT NOT NULL,
  messenger_chat_id TEXT NOT NULL,
  phone_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  header_sent_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id,delivery_epoch,generation,channel,messenger_user_id)
);
CREATE INDEX ON tt_automatic_receipt_account_deliveries(channel,next_attempt_at) WHERE status='pending';
REVOKE ALL ON tt_automatic_receipt_account_deliveries FROM PUBLIC;
