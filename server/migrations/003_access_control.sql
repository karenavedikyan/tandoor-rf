-- R1.3: roles extension, user↔1C employee links, grants, ROP teams, delegations, audit

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    'admin',
    'director',
    'rop',
    'regional_manager',
    'manager',
    'marketer',
    'analyst',
    'category_manager',
    'assistant',
    'coordinator'
  )
);

CREATE TABLE IF NOT EXISTS user_onec_employee_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  basis TEXT NOT NULL,
  confirmed_by_user_id UUID NOT NULL REFERENCES users (id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_onec_employee_links_basis_not_blank CHECK (BTRIM(basis) <> ''),
  CONSTRAINT user_onec_employee_links_active_user_uq UNIQUE (user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_onec_employee_links_active_employee_uq
  ON user_onec_employee_links (employee_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_onec_employee_links_employee_idx
  ON user_onec_employee_links (employee_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('client')),
  object_id UUID NOT NULL,
  basis TEXT NOT NULL,
  granted_by_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoke_reason TEXT,
  CONSTRAINT access_grants_basis_not_blank CHECK (BTRIM(basis) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS access_grants_active_client_uq
  ON access_grants (user_id, grant_type, object_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS access_grants_object_idx
  ON access_grants (object_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS rop_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rop_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  basis TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoke_reason TEXT,
  CONSTRAINT rop_team_members_basis_not_blank CHECK (BTRIM(basis) <> ''),
  CONSTRAINT rop_team_members_distinct CHECK (rop_user_id <> member_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS rop_team_members_active_uq
  ON rop_team_members (rop_user_id, member_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS rop_team_members_member_idx
  ON rop_team_members (member_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS coordinator_team_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rop_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  basis TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoke_reason TEXT,
  CONSTRAINT coordinator_team_assignments_basis_not_blank CHECK (BTRIM(basis) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS coordinator_team_assignments_active_uq
  ON coordinator_team_assignments (coordinator_user_id, rop_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assistant_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'pending_approval', 'active', 'revoked', 'expired')
  ),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  approved_by_user_id UUID REFERENCES users (id),
  approved_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delegations_distinct_users CHECK (delegator_user_id <> assistant_user_id),
  CONSTRAINT delegations_time_range CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS delegations_assistant_active_idx
  ON delegations (assistant_user_id, status)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS delegations_delegator_idx
  ON delegations (delegator_user_id);

CREATE TABLE IF NOT EXISTS delegation_clients (
  delegation_id UUID NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
  guid_client UUID NOT NULL,
  PRIMARY KEY (delegation_id, guid_client)
);

CREATE INDEX IF NOT EXISTS delegation_clients_guid_idx
  ON delegation_clients (guid_client);

CREATE TABLE IF NOT EXISTS delegation_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id UUID NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
  changed_by_user_id UUID NOT NULL REFERENCES users (id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB
);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users (id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_json JSONB,
  after_json JSONB,
  basis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_audit_log_created_at_idx
  ON access_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS access_audit_log_entity_idx
  ON access_audit_log (entity_type, entity_id);
