-- Phone-first canonical external party (admin-selected; no automatic merge).

CREATE TABLE IF NOT EXISTS tt_phone_canonical_parties (
  phone_e164 TEXT PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES tt_parties (id),
  set_by_user_id UUID NULL REFERENCES users (id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NULL
);
