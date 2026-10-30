-- Delivery milestone: final recipient receipt marks transfer delivered (not completed).
-- Explicit close remains status completed; completed history unchanged.

ALTER TABLE tt_transfers DROP CONSTRAINT IF EXISTS tt_transfers_status_check;
ALTER TABLE tt_transfers ADD CONSTRAINT tt_transfers_status_check
  CHECK (status IN ('active', 'waiting', 'delivered', 'completed'));

ALTER TABLE tt_transfers ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE tt_transfers ADD COLUMN IF NOT EXISTS from_external BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS tt_transfers_delivered_at_idx
  ON tt_transfers (delivered_at DESC)
  WHERE delivered_at IS NOT NULL;
