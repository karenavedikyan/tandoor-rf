-- Require password change after provisioned temporary credentials.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT FALSE;
