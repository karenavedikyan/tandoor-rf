-- Persisted wholesale employee roster from all_employees.json (clean reload / operator refresh).

CREATE TABLE IF NOT EXISTS onec_wholesale_employee_roster (
  guid_manager UUID PRIMARY KEY,
  name_manager TEXT NOT NULL DEFAULT '',
  guid_post UUID,
  post TEXT,
  condition TEXT,
  date_of_assumption TIMESTAMPTZ,
  guid_work_schedule UUID,
  work_schedule TEXT,
  decree TEXT,
  email TEXT,
  telephone TEXT,
  raw_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onec_wholesale_employee_roster_name_idx
  ON onec_wholesale_employee_roster (name_manager);

CREATE TABLE IF NOT EXISTS onec_wholesale_roster_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  source_sha256 CHAR(64) NOT NULL,
  employee_count INTEGER NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onec_wholesale_roster_state_singleton CHECK (id = 1)
);

INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
VALUES (1, repeat('0', 64), 0)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON onec_wholesale_employee_roster FROM PUBLIC;
REVOKE ALL ON onec_wholesale_roster_state FROM PUBLIC;
