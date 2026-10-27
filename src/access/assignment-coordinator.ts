import { AccessServiceError, withTransaction } from "./db";
import { getActiveUser } from "./authorization";

/** Audited role-only change; never creates accounts or resets passwords. */
export async function appointAssignmentCoordinator(actorId: string, targetId: string,
  expectedEmployeeId: string, basis: string, confirm: unknown) {
  if (confirm !== true || basis.trim().length < 10 || basis.length > 2000) {
    throw new AccessServiceError("Подтвердите назначение РОА и укажите основание.", "VALIDATION");
  }
  return withTransaction(async c => {
    const actor = await getActiveUser(c, actorId);
    if (actor.role !== "admin") throw new AccessServiceError("Нужен технический администратор.", "FORBIDDEN");
    const target = (await c.query("SELECT id::text,role,status FROM users WHERE id=$1::uuid FOR UPDATE", [targetId])).rows[0];
    if (!target || target.status !== "active") throw new AccessServiceError("Нужен существующий активный аккаунт.", "VALIDATION");
    const links = await c.query(`SELECT employee_id::text,confirmed_by_user_id FROM user_onec_employee_links
      WHERE user_id=$1::uuid AND revoked_at IS NULL FOR UPDATE`, [targetId]);
    if (links.rows.length !== 1 || links.rows[0]!.employee_id !== expectedEmployeeId || !links.rows[0]!.confirmed_by_user_id) {
      throw new AccessServiceError("Привязка к сотруднику 1С не совпала. Изменение отменено.", "CONFLICT");
    }
    if (target.role === "coordinator") return { changed: false, userId: targetId, role: "coordinator" };
    if (!["manager", "rop"].includes(target.role)) throw new AccessServiceError("Изменение этой роли запрещено.", "FORBIDDEN");
    await c.query("UPDATE users SET role='coordinator',updated_at=NOW() WHERE id=$1::uuid", [targetId]);
    await c.query(`INSERT INTO access_audit_log(actor_user_id,action,entity_type,entity_id,before_json,after_json,basis)
      VALUES($1,'ASSIGNMENT_COORDINATOR_APPOINTED','user',$2,$3::jsonb,$4::jsonb,$5)`,
    [actorId, targetId, JSON.stringify({ role: target.role }), JSON.stringify({ role: "coordinator", employeeId: expectedEmployeeId }), basis.trim()]);
    return { changed: true, userId: targetId, role: "coordinator" };
  });
}
