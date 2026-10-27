import { query } from "../db/pool";
import { AccessServiceError, withTransaction, type TransactionClient } from "./db";
import { getActiveUser } from "./authorization";
import type { AssignmentActor } from "./assignments";

type Row = Record<string, any>;
let ready = false;
export async function reviewSchemaReady(client?: TransactionClient): Promise<boolean> {
  if (!ready) {
    const sql = "SELECT to_regclass('public.assistant_assignment_reviews') IS NOT NULL AS ready";
    ready = (client ? await client.query(sql) : await query(sql)).rows[0]?.ready === true;
  }
  return ready;
}
function fail(message: string, code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" = "VALIDATION"): never {
  throw new AccessServiceError(message, code);
}
/** Server/DB time only. A cancelled-before-start or never-approved period has no work to rate. */
export const REVIEW_ELIGIBLE_SQL = `d.status IN('active','expired','revoked')
  AND d.approved_by_user_id IS NOT NULL AND d.approved_at IS NOT NULL
  AND COALESCE(d.workflow_state,'') NOT IN('rejected','cancelled')
  AND LEAST(d.ends_at,COALESCE(d.revoked_at,d.ends_at))<=NOW()
  AND GREATEST(d.starts_at,d.approved_at)<LEAST(d.ends_at,COALESCE(d.revoked_at,d.ends_at))
  AND EXISTS(SELECT 1 FROM delegation_clients worked WHERE worked.delegation_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM delegation_change_requests cr
    WHERE cr.delegation_id=d.id AND cr.status='pending_approval')`;
function scope(actor: AssignmentActor, params: unknown[]): string {
  if (["coordinator", "director"].includes(actor.role)) return "TRUE";
  if (actor.role !== "manager") fail("Оценки доступны автору, РОА и директору.", "FORBIDDEN");
  params.push(actor.id);
  return `d.delegator_user_id=$${params.length}::uuid`;
}
async function verified(actor: AssignmentActor) {
  const { getPool } = await import("../db/pool");
  const c = await getPool()!.connect();
  try {
    const user = await getActiveUser(c, actor.id);
    if (user.role !== actor.role) fail("Права изменились. Обновите страницу.", "FORBIDDEN");
    scope(actor, []);
    return user;
  } finally { c.release(); }
}
export function validateReview(body: Row): { score: number; comment: string } {
  if (typeof body.score !== "number" || !Number.isInteger(body.score) || body.score < 1 || body.score > 5) {
    fail("Выберите от 1 до 5 звёзд.");
  }
  if (typeof body.comment !== "string") fail("Добавьте комментарий от 10 до 2000 символов.");
  const comment = body.comment.trim(), length = Array.from(comment).length;
  if (length < 10 || length > 2000 || comment.includes("\0")) fail("Добавьте комментарий от 10 до 2000 символов.");
  return { score: body.score, comment };
}
export async function assignmentReviewStates(actor: AssignmentActor, ids: string[], client?: TransactionClient) {
  if (!["manager", "coordinator", "director"].includes(actor.role) || !ids.length || !(await reviewSchemaReady(client))) return new Map<string, Row>();
  const params: unknown[] = [ids], where = scope(actor, params);
  const sql = `SELECT d.id,r.score,r.submitted_at,(${REVIEW_ELIGIBLE_SQL}) AS eligible
    FROM delegations d LEFT JOIN assistant_assignment_reviews r ON r.delegation_id=d.id
    WHERE d.id=ANY($1::uuid[]) AND (${where})`;
  const result = client ? await client.query(sql, params) : await query(sql, params);
  return new Map(result.rows.map(r => [r.id, {
    state: r.score ? "rated" : r.eligible ? "required" : "not_due",
    label: r.score ? "Закрыто с оценкой" : r.eligible ? "Ожидает обязательной оценки" : "",
    score: r.score || null, submittedAt: r.submitted_at || null,
    canRate: !r.score && r.eligible && actor.role === "manager",
  }]));
}
export async function pendingAssignmentReviews(actor: AssignmentActor) {
  if (actor.role !== "manager" || !(await reviewSchemaReady())) return { count: 0, assignmentId: null, nextDueAt: null };
  const pending = await query(`SELECT COUNT(*)::int AS count,
    (array_agg(d.id ORDER BY LEAST(d.ends_at,COALESCE(d.revoked_at,d.ends_at)),d.id))[1] AS id
    FROM delegations d WHERE d.delegator_user_id=$1 AND (${REVIEW_ELIGIBLE_SQL})
      AND NOT EXISTS(SELECT 1 FROM assistant_assignment_reviews r WHERE r.delegation_id=d.id)`, [actor.id]);
  const next = await query(`SELECT MIN(d.ends_at) AS at FROM delegations d
    WHERE d.delegator_user_id=$1 AND d.status='active' AND d.revoked_at IS NULL
      AND d.approved_at IS NOT NULL AND d.ends_at>NOW()
      AND NOT EXISTS(SELECT 1 FROM assistant_assignment_reviews r WHERE r.delegation_id=d.id)`, [actor.id]);
  return { count: pending.rows[0]!.count, assignmentId: pending.rows[0]!.id || null, nextDueAt: next.rows[0]?.at || null };
}
export async function ensureReviewNotifications(actor: AssignmentActor) {
  if (actor.role !== "manager" || !(await reviewSchemaReady())) return;
  await query(`INSERT INTO assistant_assignment_notifications(user_id,delegation_id,event_key,kind,title,message)
    SELECT $1,d.id,'review-required:'||d.id::text,'review_required','Обязательная оценка работы ассистента',
      'Период работы завершён. Чтобы закрыть назначение, поставьте звёзды и оставьте комментарий. Доступ ассистента уже закрыт.'
    FROM delegations d WHERE d.delegator_user_id=$1 AND (${REVIEW_ELIGIBLE_SQL})
      AND NOT EXISTS(SELECT 1 FROM assistant_assignment_reviews r WHERE r.delegation_id=d.id)
    ON CONFLICT(user_id,event_key) DO NOTHING`, [actor.id]);
}
export async function listAssignmentReviews(actor: AssignmentActor, input: {
  page: number; q: string; assistantId: string; managerId: string; score: string; status: string;
}) {
  await verified(actor);
  const params: unknown[] = [], access = scope(actor, params);
  const base = `FROM delegations d JOIN users m ON m.id=d.delegator_user_id
    JOIN users a ON a.id=d.assistant_user_id
    LEFT JOIN assistant_assignment_reviews r ON r.delegation_id=d.id
    WHERE (${access}) AND (r.delegation_id IS NOT NULL OR (${REVIEW_ELIGIBLE_SQL}))`;
  const stats = (await query(`SELECT COUNT(r.score)::int AS rated,AVG(r.score)::float8 AS average,
    COUNT(*) FILTER(WHERE r.score<=3)::int AS low,
    COUNT(*) FILTER(WHERE r.delegation_id IS NULL)::int AS pending ${base}`, params)).rows[0]!;
  const assistants = await query(`SELECT a.id,a.full_name,COUNT(r.score)::int AS rated,AVG(r.score)::float8 AS average,
    COUNT(*) FILTER(WHERE r.score<=3)::int AS low,COUNT(*) FILTER(WHERE r.delegation_id IS NULL)::int AS pending
    ${base} GROUP BY a.id,a.full_name ORDER BY a.full_name,a.id`, params);
  const managers = await query(`SELECT DISTINCT m.id,m.full_name ${base} ORDER BY m.full_name,m.id`, params);
  let where = "";
  if (input.q) {
    params.push("%" + input.q.replace(/[%_\\]/g, "\\$&") + "%");
    where += ` AND (d.id::text ILIKE $${params.length} OR m.full_name ILIKE $${params.length}
      OR a.full_name ILIKE $${params.length} OR r.comment ILIKE $${params.length})`;
  }
  for (const [value, column] of [[input.assistantId, "d.assistant_user_id"], [input.managerId, "d.delegator_user_id"]]) {
    if (value) { params.push(value); where += ` AND ${column}=$${params.length}::uuid`; }
  }
  if (input.score === "low") where += " AND r.score<=3";
  else if (input.score) { params.push(Number(input.score)); where += ` AND r.score=$${params.length}::int`; }
  if (input.status === "required") where += " AND r.delegation_id IS NULL";
  if (input.status === "rated") where += " AND r.delegation_id IS NOT NULL";
  const count = (await query(`SELECT COUNT(*)::int AS total ${base}${where}`, params)).rows[0]!.total;
  const rows = await query(`SELECT d.id,d.delegator_user_id,d.assistant_user_id,
    m.full_name AS manager_name,a.full_name AS assistant_name,
    COALESCE(r.worked_starts_at,GREATEST(d.starts_at,d.approved_at)) AS worked_starts_at,
    COALESCE(r.worked_ends_at,LEAST(d.ends_at,COALESCE(d.revoked_at,d.ends_at))) AS worked_ends_at,
    r.score,r.submitted_at,
    (SELECT COUNT(*)::int FROM delegation_clients dc WHERE dc.delegation_id=d.id) AS client_count
    ${base}${where} ORDER BY COALESCE(r.submitted_at,LEAST(d.ends_at,COALESCE(d.revoked_at,d.ends_at))) DESC,d.id
    LIMIT 30 OFFSET $${params.length + 1}`, [...params, (input.page - 1) * 30]);
  return { items: rows.rows.map(r => ({ ...r, canRate: actor.role === "manager" && !r.score,
    state: r.score ? "rated" : "required" })), stats, assistants: assistants.rows,
    managers: managers.rows, total: count, page: input.page, pageSize: 30 };
}
export async function assignmentReview(actor: AssignmentActor, id: string) {
  await verified(actor);
  const params: unknown[] = [id], access = scope(actor, params);
  const result = await query<Row>(`SELECT r.*,m.full_name AS author_name,a.full_name AS assistant_name
    FROM assistant_assignment_reviews r JOIN delegations d ON d.id=r.delegation_id
    JOIN users m ON m.id=r.manager_user_id JOIN users a ON a.id=r.assistant_user_id
    WHERE d.id=$1 AND (${access})`, params);
  if (!result.rowCount) fail("Оценка не найдена.", "NOT_FOUND");
  const r = result.rows[0]!;
  // Historical snapshots never bypass current client visibility/explicit denials.
  const { assignmentClientsAccess } = await import("./assignments");
  const accessResult = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role,
    delegatorUserId: r.manager_user_id, entries: r.snapshot.clients || [] });
  r.snapshot = { ...r.snapshot, clients: accessResult.access === "visible" ? accessResult.clients : null };
  return r;
}
export async function submitAssignmentReview(actor: AssignmentActor, id: string, body: Row) {
  const values = validateReview(body);
  return withTransaction(async c => {
    const user = await getActiveUser(c, actor.id);
    let auditAdminId = user.id;
    let auditBusinessId: string | null = null;
    let noticeSuffix = "";
    if (actor.previewProxy) {
      if (actor.previewProxy.effectiveUserId !== user.id) {
        fail("Сессия просмотра не соответствует выбранному сотруднику.", "FORBIDDEN");
      }
      const admin = await getActiveUser(c, actor.previewProxy.adminUserId);
      if (admin.role !== "admin") fail("Действие от имени сотрудника доступно только администратору.", "FORBIDDEN");
      auditAdminId = admin.id;
      auditBusinessId = user.id;
      noticeSuffix = " Выполнено администратором " + admin.full_name + " от имени " + user.full_name + ".";
    }
    if (user.role !== actor.role || user.role !== "manager") fail("Оценку оставляет передающий менеджер.", "FORBIDDEN");
    const locked = await c.query(`SELECT d.*,m.full_name AS manager_name,a.full_name AS assistant_name,
      (${REVIEW_ELIGIBLE_SQL}) AS eligible
      FROM delegations d JOIN users m ON m.id=d.delegator_user_id JOIN users a ON a.id=d.assistant_user_id
      WHERE d.id=$1 FOR UPDATE OF d`, [id]);
    const d = locked.rows[0];
    if (!d || d.delegator_user_id !== user.id) fail("Назначение не найдено.", "NOT_FOUND");
    if (!d.eligible) fail("Оценить можно только завершённую работу по согласованному назначению.", "CONFLICT");
    if ((await c.query("SELECT 1 FROM assistant_assignment_reviews WHERE delegation_id=$1", [id])).rowCount) {
      fail("Оценка уже отправлена. Изменение не предусмотрено.", "CONFLICT");
    }
    const clients = await c.query(`SELECT dc.guid_client AS guid,COALESCE(le.name_client,oc.name_client) AS name
      FROM delegation_clients dc LEFT JOIN onec_v3_legal_entities le ON le.guid_client=dc.guid_client
      LEFT JOIN onec_clients oc ON oc.guid_client=dc.guid_client WHERE dc.delegation_id=$1 ORDER BY dc.guid_client`, [id]);
    const snap = { assignmentId: id, managerId: user.id, assistantId: d.assistant_user_id,
      managerName: user.full_name, assistantName: d.assistant_name, clients: clients.rows,
      agreedStartsAt: d.starts_at, agreedEndsAt: d.ends_at, rowVersion: d.row_version };
    await c.query(`INSERT INTO assistant_assignment_reviews(delegation_id,manager_user_id,assistant_user_id,score,comment,
      worked_starts_at,worked_ends_at,snapshot)
      VALUES($1,$2,$3,$4,$5,GREATEST($6::timestamptz,$7::timestamptz),
      LEAST($8::timestamptz,COALESCE($9::timestamptz,$8::timestamptz)),$10::jsonb)`,
    [id, user.id, d.assistant_user_id, values.score, values.comment, d.starts_at, d.approved_at, d.ends_at, d.revoked_at, JSON.stringify(snap)]);
    // Private review audit is separate from the assignment history visible to ROP.
    await c.query(`INSERT INTO access_audit_log(actor_user_id,business_actor_user_id,action,entity_type,entity_id,after_json,basis)
      VALUES($1,$2,'assignment.review_submitted','delegation',$3,$4::jsonb,'Mandatory end-of-work feedback')`,
    [auditAdminId, auditBusinessId, id, JSON.stringify({ reviewSubmitted: true, managerId: user.id, assistantId: d.assistant_user_id })]);
    await c.query(`INSERT INTO assistant_assignment_notifications(user_id,delegation_id,event_key,kind,title,message)
      SELECT id,$1::uuid,'review-received:'||($1::uuid)::text,'review_received',$2,$3 FROM users
      WHERE status='active' AND role IN('coordinator','director') ON CONFLICT(user_id,event_key) DO NOTHING`,
    [id, values.score <= 3 ? "Низкая оценка: зона внимания" : "Получена оценка работы ассистента",
      "Назначение №" + id.slice(0, 8) + ". " + values.score + " из 5. Откройте оценку для просмотра результата." + noticeSuffix]);
    await c.query(`INSERT INTO assistant_assignment_notifications(user_id,delegation_id,event_key,kind,title,message)
      VALUES($1::uuid,$2::uuid,'review-submitted:'||($2::uuid)::text,'review_submitted','Оценка передана РОА и директору',
        'Назначение закрыто с оценкой. Доступ ассистента не продлён.') ON CONFLICT(user_id,event_key) DO NOTHING`, [user.id, id]);
    return { delegationId: id, state: "rated", score: values.score };
  });
}
