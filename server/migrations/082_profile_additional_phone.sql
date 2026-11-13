-- Additive only: no backfill, merge, role change or messenger rebinding.
ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_phone TEXT
  CHECK (additional_phone IS NULL OR additional_phone ~ '^\+7[0-9]{10}$');
