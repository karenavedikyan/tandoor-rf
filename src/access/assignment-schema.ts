import fs from "node:fs";
import path from "node:path";
import { resolveMigrationsDir } from "../db/migrate-runner";
import { query } from "../db/pool";
import { AccessServiceError, withTransaction } from "./db";
import { getActiveUser } from "./authorization";

const FILENAME = "050_assistant_assignments.sql";
let knownReady = false;
export async function assignmentSchemaReady(): Promise<boolean> {
  if (knownReady) return true;
  const result = await query(`SELECT to_regclass('public.assistant_assignment_notifications') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='delegation_change_history' AND column_name='event_seq') AS ready`);
  knownReady = result.rows[0]?.ready === true;
  return knownReady;
}
/** Fixed additive migration only. No account/1C edits and no arbitrary SQL input. */
export async function prepareAssignmentSchema(actorId: string, confirm: unknown, filename: string = FILENAME) {
  if (![FILENAME, "051_assistant_assignment_reviews.sql"].includes(filename)) throw new AccessServiceError("Неизвестная миграция.", "VALIDATION");
  if (confirm !== true) throw new AccessServiceError("Подтвердите подготовку схемы назначений.", "VALIDATION");
  return withTransaction(async c => {
    const actor = await getActiveUser(c, actorId);
    if (actor.role !== "admin") throw new AccessServiceError("Нужен технический администратор.", "FORBIDDEN");
    const lock = await c.query("SELECT pg_try_advisory_xact_lock(902451001) AS locked");
    if (!lock.rows[0]?.locked) throw new AccessServiceError("Другая миграция уже выполняется.", "CONFLICT");
    const schema = await c.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN('users','delegations','delegation_change_requests','delegation_change_history')`);
    for (const [table, column] of [["users", "role"], ["delegations", "row_version"],
      ["delegation_change_requests", "proposed_starts_at"], ["delegation_change_history", "after_json"]]) {
      if (!schema.rows.some(r => r.table_name === table && r.column_name === column)) {
        throw new AccessServiceError("Схема отличается от ожидаемой. Подготовка остановлена.", "CONFLICT");
      }
    }
    const dir = resolveMigrationsDir();
    const applied = await c.query("SELECT filename FROM schema_migrations");
    const known = new Set(applied.rows.map(r => r.filename));
    const pending = fs.readdirSync(dir).filter(n => n.endsWith(".sql") && !known.has(n)).sort();
    if (!pending.length) return { ready: true, applied: false };
    if (pending.length !== 1 || pending[0] !== filename) {
      throw new AccessServiceError("Есть другие неприменённые миграции. Подготовка запрещена.", "CONFLICT");
    }
    const counts = async () => {
      const base = (await c.query(`SELECT (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM user_onec_employee_links) AS links,
        (SELECT COUNT(*)::int FROM onec_v3_legal_entities) AS legal_entities,
        (SELECT COUNT(*)::int FROM onec_v3_retail_outlets) AS outlets,
        (SELECT COUNT(*)::int FROM delegations) AS delegations,
        (SELECT COUNT(*)::int FROM delegation_change_requests) AS change_requests,
        (SELECT COUNT(*)::int FROM delegation_change_history) AS history`)).rows[0]!;
      const exists = (await c.query("SELECT to_regclass('public.assistant_assignment_notifications') IS NOT NULL AS present")).rows[0]?.present;
      base.notifications = exists ? (await c.query("SELECT COUNT(*)::int AS n FROM assistant_assignment_notifications")).rows[0]!.n : 0;
      const reviewExists = (await c.query("SELECT to_regclass('public.assistant_assignment_reviews') IS NOT NULL AS present")).rows[0]?.present;
      base.reviews = reviewExists ? (await c.query("SELECT COUNT(*)::int AS n FROM assistant_assignment_reviews")).rows[0]!.n : 0;
      return base;
    };
    const before = await counts();
    await c.query(fs.readFileSync(path.join(dir, filename), "utf8"));
    const after = await counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new AccessServiceError("Количество записей изменилось. Транзакция отменена.", "CONFLICT");
    await c.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
    await c.query(`INSERT INTO access_audit_log(actor_user_id,action,entity_type,entity_id,after_json,basis)
      VALUES($1,$2,'user',$1,$3::jsonb,$4)`,
    [actorId, filename === FILENAME ? "ASSIGNMENT_SCHEMA_READY" : "ASSIGNMENT_REVIEW_SCHEMA_READY",
      JSON.stringify({ migration: filename, before, after }), "Explicit preparation: assistant assignments, internal notifications only"]);
    return { ready: true, applied: true, before, after };
  });
}
