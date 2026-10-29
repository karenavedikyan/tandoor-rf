-- Durable Telegram webhook processing and reply delivery state

ALTER TABLE tanbot_telegram_update_dedup
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'committed',
  ADD COLUMN IF NOT EXISTS reply_chat_id BIGINT,
  ADD COLUMN IF NOT EXISTS reply_text TEXT,
  ADD COLUMN IF NOT EXISTS reply_delivered_at TIMESTAMPTZ;

ALTER TABLE tanbot_telegram_update_dedup DROP CONSTRAINT IF EXISTS tanbot_telegram_update_dedup_status_check;
ALTER TABLE tanbot_telegram_update_dedup
  ADD CONSTRAINT tanbot_telegram_update_dedup_status_check
  CHECK (status IN ('processing', 'committed', 'failed'));

UPDATE tanbot_telegram_update_dedup
SET status = 'committed',
    reply_delivered_at = COALESCE(reply_delivered_at, received_at)
WHERE status = 'committed' AND reply_delivered_at IS NULL AND reply_text IS NULL;
