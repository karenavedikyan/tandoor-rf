# R1.3 rollback notes

**Migration:** `server/migrations/003_access_control.sql`

## Rollback order (manual, test/staging only)

1. Deploy previous application build (pre-R1.3) so API again uses `requireAdmin` on clients routes.
2. In PostgreSQL (maintenance window):

```sql
BEGIN;

DROP TABLE IF EXISTS access_audit_log CASCADE;
DROP TABLE IF EXISTS delegation_change_history CASCADE;
DROP TABLE IF EXISTS delegation_clients CASCADE;
DROP TABLE IF EXISTS delegations CASCADE;
DROP TABLE IF EXISTS coordinator_team_assignments CASCADE;
DROP TABLE IF EXISTS rop_team_members CASCADE;
DROP TABLE IF EXISTS access_grants CASCADE;
DROP TABLE IF EXISTS user_onec_employee_links CASCADE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    'admin', 'director', 'rop', 'regional_manager', 'manager',
    'marketer', 'analyst', 'category_manager'
  )
);

DELETE FROM schema_migrations WHERE filename = '003_access_control.sql';

COMMIT;
```

3. Verify no user rows use `assistant` / `coordinator` before applying role constraint (migrate roles first if any were assigned in tests).

## Data preserved on rollback

- `users`, `sessions`, `onec_clients`, import runs — unchanged.
- Access configuration (links, grants, teams, delegations) — **removed** with tables above.

## Not rolled back by this migration

- Production import runs, FTP config, existing admin users.
