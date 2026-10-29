ALTER TABLE tt_external_messenger_sessions
  ADD COLUMN IF NOT EXISTS bound_telegram_user_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS bound_max_user_id BIGINT NULL;
