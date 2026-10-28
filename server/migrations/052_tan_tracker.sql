-- Tan-tracker (item handoff) — additive schema for LK production (tt56 parity)

CREATE TABLE IF NOT EXISTS tt_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('user', 'external')),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  phone_e164 TEXT,
  created_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_parties_name_trimmed CHECK (display_name = BTRIM(display_name)),
  CONSTRAINT tt_parties_phone_format CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+7\d{10}$'),
  CONSTRAINT tt_parties_user_kind CHECK (
    (kind = 'user' AND user_id IS NOT NULL) OR (kind = 'external' AND user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tt_parties_user_id_uq ON tt_parties (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tt_parties_phone_idx ON tt_parties (phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS tt_transfers (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  item_title TEXT NOT NULL,
  qty_label TEXT,
  comment_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'waiting', 'completed')),
  creator_party_id UUID NOT NULL REFERENCES tt_parties (id),
  holder_party_id UUID NOT NULL REFERENCES tt_parties (id),
  pending_party_id UUID REFERENCES tt_parties (id),
  final_recipient_party_id UUID REFERENCES tt_parties (id),
  due_at TIMESTAMPTZ,
  holder_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handoff_version INTEGER NOT NULL DEFAULT 1,
  allow_legacy_complete BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_transfers_item_trimmed CHECK (item_title = BTRIM(item_title))
);

CREATE INDEX IF NOT EXISTS tt_transfers_status_idx ON tt_transfers (status);
CREATE INDEX IF NOT EXISTS tt_transfers_holder_idx ON tt_transfers (holder_party_id);
CREATE INDEX IF NOT EXISTS tt_transfers_pending_idx ON tt_transfers (pending_party_id) WHERE pending_party_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tt_transfer_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_party_id UUID REFERENCES tt_parties (id),
  to_party_id UUID REFERENCES tt_parties (id),
  note TEXT NOT NULL,
  actor_user_id UUID REFERENCES users (id),
  CONSTRAINT tt_transfer_timeline_note_trimmed CHECK (note = BTRIM(note))
);

CREATE INDEX IF NOT EXISTS tt_transfer_timeline_transfer_idx
  ON tt_transfer_timeline (transfer_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tt_transfer_revoked_parties (
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES tt_parties (id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transfer_id, party_id)
);

CREATE TABLE IF NOT EXISTS tt_transfer_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  handoff_version INTEGER NOT NULL,
  holder_party_id UUID NOT NULL REFERENCES tt_parties (id),
  pending_party_id UUID NOT NULL REFERENCES tt_parties (id),
  item_snapshot TEXT NOT NULL,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_id, handoff_version)
);

CREATE INDEX IF NOT EXISTS tt_transfer_invitations_active_idx
  ON tt_transfer_invitations (transfer_id)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS tt_handoff_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  handoff_version INTEGER NOT NULL,
  pending_party_id UUID NOT NULL REFERENCES tt_parties (id),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_handoff_codes_lookup_idx
  ON tt_handoff_codes (transfer_id, handoff_version, pending_party_id)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS tt_transfer_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  uploaded_by_user_id UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tt_transfer_attachments_name_trimmed CHECK (original_name = BTRIM(original_name))
);

CREATE INDEX IF NOT EXISTS tt_transfer_attachments_transfer_idx
  ON tt_transfer_attachments (transfer_id, created_at);

CREATE TABLE IF NOT EXISTS tt_phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id TEXT NOT NULL REFERENCES tt_transfers (id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES tt_parties (id),
  handoff_version INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_phone_verifications_open_idx
  ON tt_phone_verifications (transfer_id, party_id)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS tt_audit_log (
  id BIGSERIAL PRIMARY KEY,
  transfer_id TEXT REFERENCES tt_transfers (id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users (id),
  acting_party_id UUID REFERENCES tt_parties (id),
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tt_audit_log_transfer_idx ON tt_audit_log (transfer_id, created_at DESC);
