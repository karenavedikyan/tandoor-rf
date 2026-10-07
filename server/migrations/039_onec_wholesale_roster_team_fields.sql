-- Team assignment fields from all_employees.json (guid_team / name_team).

ALTER TABLE onec_wholesale_employee_roster
  ADD COLUMN IF NOT EXISTS guid_team UUID,
  ADD COLUMN IF NOT EXISTS name_team TEXT;
