ALTER TABLE tt_external_messenger_sessions
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS max_chat_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS tt_ext_msg_sessions_tg_chat_idx
  ON tt_external_messenger_sessions (telegram_chat_id)
  WHERE superseded_at IS NULL AND telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tt_ext_msg_sessions_max_chat_idx
  ON tt_external_messenger_sessions (max_chat_id)
  WHERE superseded_at IS NULL AND max_chat_id IS NOT NULL;
