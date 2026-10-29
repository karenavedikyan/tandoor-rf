ALTER TABLE tt_transfers
  ADD COLUMN IF NOT EXISTS first_custody_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN tt_transfers.first_custody_at IS
  'First confirmed physical custody handoff (code/QR/holder verify); draft full-edit blocked after this.';

UPDATE tt_transfers t
SET first_custody_at = sub.min_at
FROM (
  SELECT transfer_id, MIN(created_at) AS min_at
  FROM tt_audit_log
  WHERE action IN ('code_verify_ok', 'holder_code_verify_ok', 'qr_confirm')
  GROUP BY transfer_id
) sub
WHERE t.id = sub.transfer_id
  AND t.first_custody_at IS NULL;
