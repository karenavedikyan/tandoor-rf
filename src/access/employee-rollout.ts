import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword } from "../auth/password";
import { normalizeEmail } from "../validation/email";
import { withTransaction, AccessServiceError } from "./db";

const ROLES = ["manager", "assistant", "regional_manager", "rop", "director"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RolloutEntry = {
  email: string; fullName: string; role: string; employeeId: string | null;
  userId: string | null;
};
type StagedEntry = RolloutEntry & {
  passwordHash: string; existingUserId: string | null; expectedUpdatedAt: string | null;
};
function fail(message: string, code: "VALIDATION" | "CONFLICT" | "FORBIDDEN" = "VALIDATION"): never {
  throw new AccessServiceError(message, code);
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function parseRollout(raw: unknown): { id: string; basis: string; entries: RolloutEntry[] } {
  const input = raw as Record<string, unknown>;
  if (!input || typeof input !== "object" || typeof input.id !== "string" || !UUID.test(input.id))
    fail("Укажите уникальный ID операции.");
  if (typeof input.basis !== "string" || input.basis.trim().length < 10 || input.basis.length > 2000)
    fail("Укажите основание выдачи (10–2000 символов).");
  if (input.confirmResetExisting !== true) fail("Нужно явно подтвердить перевыпуск действующих паролей.");
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 50)
    fail("Допустимо от 1 до 50 сотрудников.");
  const emails = new Set<string>(), employees = new Set<string>(), users = new Set<string>();
  const entries = input.entries.map((value: unknown): RolloutEntry => {
    const r = value as Record<string, unknown>;
    if (!r || typeof r !== "object") fail("Некорректная строка сотрудника.");
    const email = typeof r.email === "string" ? normalizeEmail(r.email) : null;
    if (!email || !/^[^\r\n|]+$/.test(email)) fail("Некорректный email.");
    const fullName = typeof r.fullName === "string" ? r.fullName.trim() : "";
    if (fullName.length < 2 || fullName.length > 200 || /[\r\n|]/.test(fullName)) fail("Некорректное ФИО.");
    if (typeof r.role !== "string" || !ROLES.includes(r.role)) fail("Недопустимая роль; admin не выдаётся.");
    const employeeId = r.employeeId == null ? null : String(r.employeeId).toLowerCase();
    const userId = r.userId == null ? null : String(r.userId).toLowerCase();
    if ((employeeId && !UUID.test(employeeId)) || (userId && !UUID.test(userId))) fail("Некорректный GUID.");
    if (!employeeId && r.role !== "director") fail("Сотруднику нужна реальная привязка к 1С.");
    if (emails.has(email) || (employeeId && employees.has(employeeId)) || (userId && users.has(userId)))
      fail("Повтор email, аккаунта или сотрудника в списке.");
    emails.add(email); if (employeeId) employees.add(employeeId); if (userId) users.add(userId);
    return { email, fullName, role: r.role, employeeId, userId };
  });
  return { id: input.id.toLowerCase(), basis: input.basis.trim(), entries };
}
async function actor(client: PoolClient, id: string): Promise<void> {
  const r = await client.query("SELECT role,status,password_must_change FROM users WHERE id=$1 FOR UPDATE", [id]);
  if (r.rows[0]?.role !== "admin" || r.rows[0]?.status !== "active" || r.rows[0]?.password_must_change)
    fail("Нужен действующий администратор.", "FORBIDDEN");
}
async function resolveEntry(client: PoolClient, entry: RolloutEntry) {
  if (entry.employeeId) {
    const emp = await client.query("SELECT 1 FROM onec_wholesale_employee_roster WHERE guid_manager=$1", [entry.employeeId]);
    if (!emp.rowCount) fail("GUID сотрудника отсутствует в кадровой выгрузке.", "CONFLICT");
  }
  const r = await client.query(`SELECT u.id,u.email,u.role,u.status,u.updated_at::text AS stamp
    FROM users u WHERE lower(u.email)=$1 OR u.id=$2::uuid OR u.id IN (
      SELECT user_id FROM user_onec_employee_links WHERE employee_id=$3::uuid AND revoked_at IS NULL
    ) ORDER BY u.id FOR UPDATE`, [entry.email, entry.userId, entry.employeeId]);
  if (r.rowCount! > 1) fail("Email, user ID и сотрудник указывают на разные аккаунты.", "CONFLICT");
  const existing = r.rows[0] ?? null;
  if (entry.userId && existing?.id !== entry.userId) fail("Подтверждённый аккаунт не найден.", "CONFLICT");
  if (existing?.role === "admin") fail("Административный аккаунт нельзя перевыпустить этой операцией.", "FORBIDDEN");
  if (existing?.status === "disabled") fail("Отключённый аккаунт требует отдельного разбора.", "CONFLICT");
  if (existing) {
    const links = await client.query(`SELECT employee_id::text FROM user_onec_employee_links
      WHERE user_id=$1 AND revoked_at IS NULL`, [existing.id]);
    if (links.rows.some(l => l.employee_id !== entry.employeeId))
      fail("Действующую привязку к другому сотруднику менять нельзя.", "CONFLICT");
  }
  return existing as { id: string; email: string; role: string; status: string; stamp: string } | null;
}
async function audit(client: PoolClient, actorId: string, action: string,
  entityId: string, after: unknown, basis: string) {
  await client.query(`INSERT INTO access_audit_log
    (actor_user_id,action,entity_type,entity_id,after_json,basis) VALUES ($1,$2,'user',$3,$4::jsonb,$5)`,
  [actorId, action, entityId, JSON.stringify(after), basis]);
}
export async function stageEmployeeRollout(actorId: string, raw: unknown) {
  const plan = parseRollout(raw);
  const receipt = randomBytes(32).toString("base64url");
  const passwords = plan.entries.map(() => randomBytes(18).toString("base64url"));
  // Passwords are never included in audit, persistent JSON, errors, or logs.
  const hashes: string[] = [];
  for (const password of passwords) hashes.push(await hashPassword(password));
  return withTransaction(async client => {
    await actor(client, actorId);
    await client.query("SELECT pg_advisory_xact_lock(902451043)");
    const duplicate = await client.query("SELECT state FROM employee_access_rollouts WHERE id=$1", [plan.id]);
    if (duplicate.rowCount) fail("Операция уже существует. Повторная выдача файла запрещена.", "CONFLICT");
    const staged: StagedEntry[] = [];
    for (let i = 0; i < plan.entries.length; i++) {
      const entry = plan.entries[i]!;
      const existing = await resolveEntry(client, entry);
      if (existing?.id === actorId) fail("Нельзя перевыпустить собственную сессию администратора.", "FORBIDDEN");
      staged.push({ ...entry, passwordHash: hashes[i]!, existingUserId: existing?.id ?? null,
        expectedUpdatedAt: existing?.stamp ?? null });
    }
    await client.query(`INSERT INTO employee_access_rollouts
      (id,actor_user_id,basis,state,entries_json,receipt_hash,expires_at)
      VALUES ($1,$2,$3,'staged',$4::jsonb,$5,NOW()+INTERVAL '30 minutes')`,
    [plan.id, actorId, plan.basis, JSON.stringify(staged), digest(receipt)]);
    await audit(client, actorId, "EMPLOYEE_ROLLOUT_STAGED", actorId,
      { operationId: plan.id, count: staged.length }, plan.basis);
    const metadata = JSON.stringify({ id: plan.id, receipt });
    const markdown = `<!-- tandoor-rollout:${metadata} -->\n# Тандор: временные доступы\n\n` +
      `Вход: https://lk.tandoor.ru/login\n\n` +
      `Конфиденциально. Передавайте каждому сотруднику только его строку, не весь файл. ` +
      `Пароль нужно сменить при первом входе. До подтверждения администратором выдача не активна.\n\n` +
      `| Сотрудник | Роль | Логин | Временный пароль |\n|---|---|---|---|\n` +
      staged.map((e, i) => `| ${e.fullName} | ${e.role} | ${e.email} | ${passwords[i]} |`).join("\n") + "\n";
    return { id: plan.id, receipt, count: staged.length,
      existing: staged.filter(e => e.existingUserId).length, markdown };
  });
}
export async function rolloutStatus(actorId: string, id: string) {
  if (!UUID.test(id)) fail("Некорректный ID.");
  return withTransaction(async client => {
    await actor(client, actorId);
    const r = await client.query(`SELECT id,state,expires_at,applied_at,
      jsonb_array_length(entries_json) AS count FROM employee_access_rollouts
      WHERE id=$1 AND actor_user_id=$2`, [id, actorId]);
    if (!r.rowCount) fail("Операция не найдена.", "CONFLICT");
    const status = r.rows[0];
    if (status.state !== "applied") return status;
    const checks = await client.query(`WITH targets AS (
      SELECT u.* FROM users u JOIN employee_access_rollouts r ON r.id=$1
      WHERE lower(u.email) IN (SELECT e->>'email' FROM jsonb_array_elements(r.entries_json) e)
    ) SELECT
      (SELECT COUNT(*)::int FROM targets) AS account_count,
      (SELECT COUNT(*)::int FROM targets WHERE password_must_change) AS must_change_password_count,
      (SELECT COUNT(*)::int FROM sessions s JOIN targets t ON t.id=s.user_id
        WHERE s.revoked_at IS NULL AND s.expires_at>NOW()) AS active_sessions,
      (SELECT COUNT(*)::int FROM user_onec_employee_links l JOIN targets t ON t.id=l.user_id
        WHERE l.revoked_at IS NULL) AS employee_links,
      (SELECT COUNT(*)::int FROM director_base_access_grants g JOIN targets t ON t.id=g.user_id
        WHERE g.revoked_at IS NULL AND t.role='director') AS explicit_director_grants,
      (SELECT COUNT(*)::int FROM delegations d JOIN targets t ON t.id=d.assistant_user_id
        WHERE t.role='assistant' AND d.status='active' AND d.revoked_at IS NULL
        AND d.starts_at<=NOW() AND d.ends_at>NOW()) AS active_assistant_assignments,
      (SELECT jsonb_object_agg(role,n) FROM
        (SELECT role,COUNT(*)::int n FROM targets GROUP BY role) counts) AS roles`, [id]);
    return { ...status, verification: checks.rows[0] };
  });
}
export async function applyEmployeeRollout(actorId: string, id: string, receipt: unknown) {
  if (!UUID.test(id)) fail("Некорректный ID.");
  return withTransaction(async client => {
    await actor(client, actorId);
    await client.query("SELECT pg_advisory_xact_lock(902451043)");
    const r = await client.query(`SELECT * FROM employee_access_rollouts
      WHERE id=$1 AND actor_user_id=$2 FOR UPDATE`, [id, actorId]);
    const batch = r.rows[0];
    if (!batch) fail("Операция не найдена.", "CONFLICT");
    if (batch.state === "applied") return { ok: true, id, state: "applied", count: batch.entries_json.length };
    if (batch.state !== "staged" || new Date(batch.expires_at).getTime() <= Date.now())
      fail("Подготовка отменена или истекла. Действующие аккаунты не изменены.", "CONFLICT");
    if (typeof receipt !== "string" || receipt.length > 200 ||
      !timingSafeEqual(Buffer.from(digest(receipt)), Buffer.from(batch.receipt_hash)))
      fail("Нужно подтверждение получения файла паролей.", "FORBIDDEN");
    const entries = batch.entries_json as StagedEntry[];
    const resolved = [];
    // Validate the complete batch again under locks BEFORE writing any account.
    for (const entry of entries) {
      const existing = await resolveEntry(client, entry);
      if ((existing?.id ?? null) !== entry.existingUserId ||
        (existing?.stamp ?? null) !== entry.expectedUpdatedAt)
        fail("Аккаунт изменился после подготовки. Вся операция остановлена.", "CONFLICT");
      resolved.push(existing);
    }
    const appliedUserIds: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!, previous = resolved[i];
      const userId = previous?.id ?? randomUUID();
      appliedUserIds.push(userId);
      if (previous) {
        await client.query(`UPDATE users SET email=$2,full_name=$3,role=$4,password_hash=$5,
          password_must_change=TRUE,status='active',updated_at=NOW() WHERE id=$1`,
        [userId, entry.email, entry.fullName, entry.role, entry.passwordHash]);
        await client.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      } else {
        await client.query(`INSERT INTO users
          (id,email,full_name,role,password_hash,password_must_change,status)
          VALUES ($1,$2,$3,$4,$5,TRUE,'active')`,
        [userId, entry.email, entry.fullName, entry.role, entry.passwordHash]);
      }
      if (entry.employeeId) {
        const link = await client.query("SELECT id FROM user_onec_employee_links WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
        if (!link.rowCount) {
          await client.query(`INSERT INTO user_onec_employee_links
            (user_id,employee_id,basis,confirmed_by_user_id) VALUES ($1,$2,$3,$4)`,
          [userId, entry.employeeId, batch.basis, actorId]);
        }
      }
      if (entry.role === "director" && !entry.employeeId) {
        await client.query(`INSERT INTO director_base_access_grants (user_id,granted_by_user_id,basis)
          VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE
          SET granted_by_user_id=EXCLUDED.granted_by_user_id,basis=EXCLUDED.basis,
            created_at=NOW(),revoked_at=NULL`, [userId, actorId, batch.basis]);
      } else {
        await client.query("UPDATE director_base_access_grants SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      }
      await audit(client, actorId, "EMPLOYEE_ACCESS_REISSUED", userId, {
        operationId: id, email: entry.email, role: entry.role, employeeId: entry.employeeId,
        previousEmail: previous?.email ?? null, previousRole: previous?.role ?? null,
        passwordMustChange: true, directorExplicitBase: entry.role === "director" && !entry.employeeId,
      }, batch.basis);
    }
    // Approval workflows use confirmed user-to-user teams. Derive only the
    // approved users' relationships from the existing authoritative 1C teams.
    // Never create a cross-team relation or revoke a pre-existing manual one.
    const teamLinks = await client.query(`INSERT INTO rop_team_members
      (rop_user_id,member_user_id,basis,created_by_user_id)
      SELECT DISTINCT leader.id,member.id,$2::text,$3::uuid
      FROM onec_wholesale_team_groups g
      JOIN onec_wholesale_employee_team_memberships m ON m.guid_team=g.guid_team
      JOIN user_onec_employee_links ll ON ll.employee_id=g.guid_team_leader AND ll.revoked_at IS NULL
      JOIN user_onec_employee_links ml ON ml.employee_id=m.guid_manager AND ml.revoked_at IS NULL
      JOIN users leader ON leader.id=ll.user_id
      JOIN users member ON member.id=ml.user_id
      WHERE leader.id=ANY($1::uuid[]) AND member.id=ANY($1::uuid[])
        AND leader.role='rop' AND leader.status='active'
        AND member.role IN ('manager','regional_manager') AND member.status='active'
        AND leader.id<>member.id
      ON CONFLICT (rop_user_id,member_user_id) WHERE revoked_at IS NULL DO NOTHING
      RETURNING rop_user_id,member_user_id`, [appliedUserIds, batch.basis, actorId]);
    if (teamLinks.rowCount) await audit(client, actorId, "EMPLOYEE_ROLLOUT_TEAMS_CONFIRMED",
      actorId, { operationId: id, source: "1C existing team memberships", added: teamLinks.rows }, batch.basis);
    await client.query(`UPDATE employee_access_rollouts SET state='applied',applied_at=NOW(),
      receipt_hash=NULL,entries_json=$2::jsonb WHERE id=$1`,
    [id, JSON.stringify(entries.map(({ passwordHash, expectedUpdatedAt, ...e }) => e))]);
    return { ok: true, id, state: "applied", count: entries.length };
  });
}
export async function cancelEmployeeRollout(actorId: string, id: string) {
  if (!UUID.test(id)) fail("Некорректный ID.");
  return withTransaction(async client => {
    await actor(client, actorId);
    const r = await client.query(`UPDATE employee_access_rollouts SET state='cancelled',
      entries_json='[]'::jsonb,receipt_hash=NULL WHERE id=$1 AND actor_user_id=$2 AND state='staged'
      RETURNING id`, [id, actorId]);
    if (!r.rowCount) fail("Подготовка не найдена или уже завершена.", "CONFLICT");
    return { ok: true, state: "cancelled" };
  });
}
