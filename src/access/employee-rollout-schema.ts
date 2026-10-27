import fs from "node:fs";
import { resolveMigrationsDir } from "../db/migrate-runner";
import path from "node:path";
import { withTransaction, AccessServiceError } from "./db";
const FILENAME = "049_employee_access_rollouts.sql";
/** An explicit admin action may apply ONLY this additive migration, never arbitrary SQL. */
export async function initializeEmployeeRolloutSchema(actorId: string, confirm: unknown) {
  if (confirm !== true) throw new AccessServiceError("Подтвердите подготовку схемы выдачи.", "VALIDATION");
  return withTransaction(async client => {
    const actor = await client.query("SELECT role,status FROM users WHERE id=$1", [actorId]);
    if (actor.rows[0]?.role !== "admin" || actor.rows[0]?.status !== "active")
      throw new AccessServiceError("Нужен администратор.", "FORBIDDEN");
    const locked = await client.query("SELECT pg_try_advisory_xact_lock(902451001) AS locked");
    if (!locked.rows[0].locked) throw new AccessServiceError("Выполняется другая миграция.", "CONFLICT");
    // Inspect the actual live schema before any DDL. No user values or secrets are read.
    const schema = await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN
      ('users','sessions','user_onec_employee_links','access_audit_log')`);
    for (const [table, column] of [["users", "password_must_change"], ["sessions", "revoked_at"],
      ["user_onec_employee_links", "confirmed_by_user_id"], ["access_audit_log", "after_json"]]) {
      if (!schema.rows.some(r => r.table_name === table && r.column_name === column))
        throw new AccessServiceError("Схема рабочей БД отличается от ожидаемой; подготовка остановлена.", "CONFLICT");
    }
    const dir = resolveMigrationsDir();
    const all = fs.readdirSync(dir).filter(n => n.endsWith(".sql")).sort();
    const applied = await client.query("SELECT filename FROM schema_migrations");
    const known = new Set(applied.rows.map(r => r.filename));
    const pending = all.filter(n => !known.has(n));
    if (pending.length === 0) return { ready: true, applied: false };
    if (pending.length !== 1 || pending[0] !== FILENAME)
      throw new AccessServiceError("Есть другие неприменённые миграции. Автоматическая подготовка запрещена.", "CONFLICT");
    const counts = await client.query(`SELECT (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM user_onec_employee_links) AS employee_links`);
    await client.query(fs.readFileSync(path.join(dir, FILENAME), "utf8"));
    await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [FILENAME]);
    await client.query(`INSERT INTO access_audit_log(actor_user_id,action,entity_type,entity_id,after_json,basis)
      VALUES($1,'EMPLOYEE_ROLLOUT_SCHEMA_READY','user',$1,$2::jsonb,$3)`,
    [actorId, JSON.stringify({ migration: FILENAME, counts: counts.rows[0] }),
      "Explicitly authorized employee access rollout; additive schema only"]);
    return { ready: true, applied: true, unchangedAccounts: counts.rows[0] };
  });
}
