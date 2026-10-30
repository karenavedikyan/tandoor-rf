-- Personal registry visibility, admin general archive, pre-receipt delete tombstone (additive)

CREATE TABLE IF NOT EXISTS tt_personal_registry_flags (
  owner_party_id UUID NOT NULL REFERENCES tt_parties (id) ON DELETE CASCADE,
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NULL,
  personal_archived_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_party_id, transfer_id)
);

CREATE INDEX IF NOT EXISTS tt_personal_registry_flags_owner_idx
  ON tt_personal_registry_flags (owner_party_id);

CREATE INDEX IF NOT EXISTS tt_personal_registry_flags_archived_idx
  ON tt_personal_registry_flags (owner_party_id)
  WHERE personal_archived_at IS NOT NULL;

ALTER TABLE tt_transfers
  ADD COLUMN IF NOT EXISTS general_archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS general_archived_by_user_id UUID NULL REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID NULL REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tt_transfers_general_archived_idx
  ON tt_transfers (general_archived_at)
  WHERE general_archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS tt_transfers_deleted_at_idx
  ON tt_transfers (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS tt_general_archive_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'restore')),
  actor_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_general_archive_audit_transfer_idx
  ON tt_general_archive_audit (transfer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tt_transfer_delete_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_public_code TEXT NOT NULL,
  actor_user_id UUID NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_party_id UUID NULL REFERENCES tt_parties (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_transfer_delete_audit_code_idx
  ON tt_transfer_delete_audit (transfer_public_code, created_at DESC);
