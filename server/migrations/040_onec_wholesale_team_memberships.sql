-- G3: nested team[] memberships and group leaders from all_employees.json.

CREATE TABLE IF NOT EXISTS onec_wholesale_team_groups (
  guid_team UUID PRIMARY KEY,
  name_team TEXT,
  guid_team_leader UUID,
  name_team_leader TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_wholesale_employee_team_memberships (
  guid_manager UUID NOT NULL REFERENCES onec_wholesale_employee_roster (guid_manager) ON DELETE CASCADE,
  guid_team UUID NOT NULL,
  name_team TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guid_manager, guid_team)
);

CREATE INDEX IF NOT EXISTS onec_wholesale_employee_team_memberships_team_idx
  ON onec_wholesale_employee_team_memberships (guid_team);

REVOKE ALL ON onec_wholesale_team_groups FROM PUBLIC;
REVOKE ALL ON onec_wholesale_employee_team_memberships FROM PUBLIC;
