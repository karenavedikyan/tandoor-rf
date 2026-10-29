-- Durable Tan-Tracker attachment bytes (App Platform / no persistent local disk).
-- storage_key matches tt_staged_attachments.storage_key and tt_transfer_attachments.storage_key.

CREATE TABLE IF NOT EXISTS tt_attachment_blobs (
  storage_key TEXT PRIMARY KEY,
  content BYTEA NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_attachment_blobs_byte_size_matches CHECK (byte_size = octet_length(content))
);

CREATE INDEX IF NOT EXISTS tt_attachment_blobs_created_at_idx
  ON tt_attachment_blobs (created_at);

COMMENT ON TABLE tt_attachment_blobs IS
  'Binary payload for Tan-Tracker attachments when TT_ATTACHMENTS_BACKEND=postgres. Monitor disk via pg_database_size and periodic cleanup of orphaned staged keys.';
