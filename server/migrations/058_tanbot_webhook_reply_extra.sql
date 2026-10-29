-- Persist inline keyboard / callback payload for durable webhook reply retry and dedup resend

ALTER TABLE tanbot_telegram_update_dedup
  ADD COLUMN IF NOT EXISTS reply_extra JSONB;

ALTER TABLE tanbot_max_update_dedup
  ADD COLUMN IF NOT EXISTS reply_extra JSONB;
