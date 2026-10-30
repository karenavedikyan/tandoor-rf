-- Allow multiple draft rows per chat after confirm; at most one active (unconfirmed) draft per channel+chat.

ALTER TABLE tt_external_request_drafts
  DROP CONSTRAINT IF EXISTS tt_external_request_drafts_channel_chat_uq;

CREATE UNIQUE INDEX IF NOT EXISTS tt_external_request_drafts_active_chat_uq
  ON tt_external_request_drafts (channel, messenger_chat_id)
  WHERE confirmed_transfer_id IS NULL;
