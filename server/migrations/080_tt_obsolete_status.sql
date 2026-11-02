-- Cancellation is not successful completion and never proves physical receipt.
ALTER TABLE tt_transfers DROP CONSTRAINT IF EXISTS tt_transfers_status_check;
ALTER TABLE tt_transfers ADD CONSTRAINT tt_transfers_status_check
  CHECK (status IN ('active', 'waiting', 'delivered', 'completed', 'obsolete'));
