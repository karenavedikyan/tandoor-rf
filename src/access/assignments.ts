import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { query } from "../db/pool";
import { AccessServiceError, withTransaction } from "./db";
import { getActiveUser, getEmployeeId } from "./authorization";
import { isValidUuidParam } from "../clients/uuid-param";
import { loadAccessContext } from "./context";
import { resolveDelegationClientsAccess, type DelegationClientsAccess, type DelegationClientEntry } from "./delegation-client-visibility";
import { parseDelegationWindow, parseStrictClientGuids } from "./validation";
import { enrichDelegationRow } from "./delegation-status";
import { readableGroupKey } from "../clients/v3/list-legal-grouped";
import { LEGAL_CITY_SQL } from "../clients/v3/list-sql-expressions";
import { isExchangeV3Active } from "../clients/v3/list";
import { v3EntityAssignmentScope } from "../clients/v3/access-scope";
import { v3JsonManagerField } from "../clients/v3/json-paths";
import type { ActiveUserRow } from "./types";

type Row = Record<string, any>;
export type AssignmentActor = { id: string; role: string };
function fail(message: string, code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" = "VALIDATION"): never {
  throw new AccessServiceError(message, code);
}
function text(value: unknown, required = false): string {
  if (typeof value !== "string" || value.trim().length > 2000 || (required && value.trim().length < 5)) {
    if (required) fail("Укажите основание: от 5 до 2000 символов.");
    return "";
  }
  return value.trim();
}
async function actorInTransaction(c: PoolClient, actor: AssignmentActor): Promise<ActiveUserRow> {
  const user = await getActiveUser(c, actor.id);
  if (user.role !== actor.role) fail("Права изменились. Обновите страницу.", "FORBIDDEN");
  return user;
}
function isAuthor(user: AssignmentActor, d: Row): boolean {
  return user.role === "coordinator" ||
    (user.role === "manager" && user.id === d.delegator_user_id);
}
function requireAuthor(user: AssignmentActor, d: Row): void {
  if (!isAuthor(user, d)) fail("Недостаточно прав для изменения назначения.", "FORBIDDEN");
}
function requireCoordinator(user: AssignmentActor): void {
  if (user.role !== "coordinator") fail("Решения принимает только координатор, руководитель ассистентов.", "FORBIDDEN");
}
async function assignmentClientsAccess(input: {
  actorUserId: string; actorRole: string; delegatorUserId: string; entries: DelegationClientEntry[];
}): Promise<DelegationClientsAccess> {
  if (!(await isExchangeV3Active())) return resolveDelegationClientsAccess(input);
  const restricted = { access: "restricted" as const, clients: null, message: "Состав клиентов ограничен правами." };
  const ctx = await loadAccessContext(input.actorRole === "coordinator" ? input.delegatorUserId : input.actorUserId);
  const scope = v3EntityAssignmentScope(ctx, "le", "legal");
  const params: unknown[] = [...scope.params, input.entries.map(v => v.guid), input.actorUserId];
  const result = await query(`SELECT le.guid_client FROM onec_v3_legal_entities le WHERE (${scope.clause})
    AND le.guid_client=ANY($${params.length - 1}::uuid[]) AND NOT EXISTS(
      SELECT 1 FROM access_denials ad WHERE ad.user_id=$${params.length}::uuid AND ad.revoked_at IS NULL
        AND (ad.scope_type='all_clients' OR ad.object_id=le.guid_client))`, params);
  return result.rowCount === new Set(input.entries.map(v => v.guid)).size
    ? { access: "visible", clients: input.entries } : restricted;
}
async function validateTerms(c: PoolClient, user: AssignmentActor, delegatorId: string, body: Row) {
  if (!isValidUuidParam(delegatorId) || typeof body.assistantUserId !== "string" || !isValidUuidParam(body.assistantUserId)) {
    fail("Выберите менеджера и ассистента.");
  }
  if (![body.startsAt, body.endsAt].every(v => typeof v === "string" && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(v))) {
    fail("Укажите даты с часовым поясом. В форме используется Москва (МСК).");
  }
  const guids = parseStrictClientGuids(body.clientGuids);
  const window = parseDelegationWindow(body.startsAt, body.endsAt);
  if ("error" in guids) fail(guids.error);
  if ("error" in window) fail(window.error);
  if (guids.guids.length > 2000) fail("Не более 2000 юрлиц в одном назначении.");
  if (new Date(window.endsAt).getTime() <= Date.now()) fail("Окончание должно быть в будущем.");
  const delegator = await getActiveUser(c, delegatorId);
  if (!["manager", "rop"].includes(delegator.role)) fail("Выберите передающего менеджера.");
  const assistant = await getActiveUser(c, String(body.assistantUserId));
  if (assistant.role !== "assistant") fail("Получатель должен иметь роль ассистента.");
  const link = await c.query("SELECT 1 FROM user_onec_employee_links WHERE user_id=$1 AND revoked_at IS NULL", [assistant.id]);
  if (!link.rowCount) fail("У ассистента не подтверждена связь с сотрудником 1С.");
  if (!(await isExchangeV3Active())) fail("Назначения доступны после загрузки новой клиентской базы 1С.");
  const employeeId = await getEmployeeId(c, delegator.id);
  const owned = await c.query(`SELECT le.guid_client FROM onec_v3_legal_entities le
    WHERE le.guid_client=ANY($1::uuid[]) AND lower(${v3JsonManagerField("le", "guidManager")})=lower($2::text)
      AND NOT EXISTS(SELECT 1 FROM access_denials ad WHERE ad.user_id=$3 AND ad.revoked_at IS NULL
        AND (ad.scope_type='all_clients' OR ad.object_id=le.guid_client))`, [guids.guids, employeeId, delegator.id]);
  if (owned.rowCount !== guids.guids.length) fail("Выбранные клиенты не входят в действующую базу передающего менеджера.", "FORBIDDEN");
  if (user.role === "coordinator") {
    const denied = await c.query(`SELECT 1 FROM access_denials WHERE user_id=$1 AND revoked_at IS NULL
      AND (scope_type='all_clients' OR object_id=ANY($2::uuid[])) LIMIT 1`, [user.id, guids.guids]);
    if (denied.rowCount) fail("Явный запрет ограничивает доступ координатора к выбранным клиентам.", "FORBIDDEN");
  }
  return { clientGuids: guids.guids, ...window, assistantUserId: assistant.id, basis: text(body.basis, true) };
}

// Per-client transaction locks serialize approvals across ALL assistants and territories.
async function lockClients(c: PoolClient, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["assistant-assignment:" + id]);
  }
}
async function assertNoOverlap(c: PoolClient, id: string, guids: string[], starts: string, ends: string): Promise<void> {
  const collisions = await c.query(`SELECT d.id FROM delegations d WHERE d.id<>$1::uuid
    AND d.status='active' AND d.revoked_at IS NULL AND (
      (d.starts_at<$4::timestamptz AND $3::timestamptz<d.ends_at AND EXISTS (
        SELECT 1 FROM delegation_clients dc WHERE dc.delegation_id=d.id AND dc.guid_client=ANY($2::uuid[])))
      OR EXISTS (SELECT 1 FROM delegation_change_requests r
        JOIN delegation_change_request_clients rc ON rc.change_request_id=r.id
        WHERE r.delegation_id=d.id AND r.status='pending_approval' AND rc.guid_client=ANY($2::uuid[])
          AND r.proposed_starts_at<$4::timestamptz AND $3::timestamptz<r.proposed_ends_at)
    ) LIMIT 1`, [id, guids, starts, ends]);
  if (collisions.rowCount) fail("У выбранных клиентов пересекается период другого назначения. Уточните клиентов или даты.", "CONFLICT");
}
async function replaceClients(c: PoolClient, id: string, guids: string[]): Promise<void> {
  await c.query("DELETE FROM delegation_clients WHERE delegation_id=$1", [id]);
  await c.query(`INSERT INTO delegation_clients(delegation_id,guid_client)
    SELECT $1::uuid,unnest($2::uuid[])`, [id, guids]);
}
async function snapshot(c: PoolClient, id: string): Promise<Row> {
  const result = await c.query(`SELECT d.*, m.full_name AS delegator_name, a.full_name AS assistant_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('guid',dc.guid_client,'name',COALESCE(le.name_client,oc.name_client)) ORDER BY dc.guid_client)
      FROM delegation_clients dc LEFT JOIN onec_clients oc ON oc.guid_client=dc.guid_client
      LEFT JOIN onec_v3_legal_entities le ON le.guid_client=dc.guid_client
      WHERE dc.delegation_id=d.id),'[]') AS clients,
    (SELECT jsonb_build_object('id',r.id,'starts_at',r.proposed_starts_at,'ends_at',r.proposed_ends_at,
      'assistant_user_id',COALESCE(r.proposed_assistant_user_id,d.assistant_user_id),
      'assistant_name',pa.full_name,'basis',r.basis,
      'clients',COALESCE((SELECT jsonb_agg(jsonb_build_object('guid',rc.guid_client,'name',COALESCE(le.name_client,oc.name_client)) ORDER BY rc.guid_client)
        FROM delegation_change_request_clients rc LEFT JOIN onec_clients oc ON oc.guid_client=rc.guid_client
        LEFT JOIN onec_v3_legal_entities le ON le.guid_client=rc.guid_client
        WHERE rc.change_request_id=r.id),'[]'))
      FROM delegation_change_requests r LEFT JOIN users pa ON pa.id=COALESCE(r.proposed_assistant_user_id,d.assistant_user_id)
      WHERE r.delegation_id=d.id AND r.status='pending_approval' LIMIT 1) AS proposal
    FROM delegations d JOIN users m ON m.id=d.delegator_user_id JOIN users a ON a.id=d.assistant_user_id
    WHERE d.id=$1`, [id]);
  return result.rows[0]!;
}
async function record(c: PoolClient, user: ActiveUserRow, id: string, action: string, before: Row | null, comment: string): Promise<void> {
  const after = await snapshot(c, id);
  const event = randomUUID();
  await c.query(`INSERT INTO delegation_change_history(id,delegation_id,changed_by_user_id,change_type,
    before_json,after_json,actor_role,actor_name,snapshot,comment)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6,$9)`,
  [event, id, user.id, action, before ? JSON.stringify(before) : null, JSON.stringify(after), user.role, user.full_name, comment]);
  await c.query(`INSERT INTO access_audit_log(actor_user_id,action,entity_type,entity_id,before_json,after_json,basis)
    VALUES($1,$2,'delegation',$3,$4,$5,$6)`,
  [user.id, "assignment." + action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), comment]);

  const labels: Record<string, string> = {
    submit: "Новая заявка на назначение", approve: "Назначение согласовано", reject: "Назначение отклонено",
    return: "Заявка возвращена на уточнение", cancel: "Заявка отменена", revoke: "Доступ ассистента отозван",
    propose_change: "Изменения ждут согласования", approve_change: "Изменения согласованы",
    reject_change: "Изменения отклонены", return_change: "Изменения возвращены на уточнение",
    cancel_change: "Запрос изменений отменён",
  };
  if (!labels[action]) return;
  const ids = new Set<string>([after.delegator_user_id]);
  if (["submit", "propose_change", "cancel", "cancel_change"].includes(action)) {
    const coords = await c.query("SELECT id FROM users WHERE role='coordinator' AND status='active'");
    for (const row of coords.rows) ids.add(row.id);
  }
  if (["approve", "revoke", "propose_change", "approve_change", "reject_change", "return_change", "cancel_change"].includes(action)) {
    ids.add(after.assistant_user_id);
    if (before) ids.add(before.assistant_user_id);
  }
  if (user.role === "coordinator") {
    const directors = await c.query("SELECT id FROM users WHERE role='director' AND status='active'");
    for (const row of directors.rows) ids.add(row.id);
  }
  const range = `${new Date(after.starts_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} — ${new Date(after.ends_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`;
  for (const recipient of ids) {
    const target = await getActiveUser(c, recipient).catch(() => null);
    if (!target) continue;
    // No client identities, turnover, or decision comments in the notification payload.
    let message = "Назначение №" + id.slice(0, 8) + ". " + range + ".";
    if (target.role === "assistant") {
      message += action === "propose_change" ? " Доступ приостановлен до решения координатора."
        : action === "approve_change" && recipient !== after.assistant_user_id ? " Ваш доступ завершён."
        : action === "reject_change" || action === "return_change" || action === "cancel_change" ? " Сохраняются прежние условия доступа."
        : action === "revoke" ? " Доступ закрыт." : " Откройте раздел «Клиенты».";
    }
    await c.query(`INSERT INTO assistant_assignment_notifications(user_id,delegation_id,event_key,kind,title,message)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_key) DO NOTHING`,
    [recipient, id, event, action, labels[action], message]);
  }
}

export async function writeAssignment(actor: AssignmentActor, action: string, id: string | null, body: Row) {
  return withTransaction(async c => {
    const user = await actorInTransaction(c, actor);
    if (!["manager", "coordinator"].includes(user.role)) fail("Эта роль не изменяет назначения.", "FORBIDDEN");
    if (action === "create") {
      const delegatorId = user.role === "manager" ? user.id : String(body.delegatorUserId);
      if (user.role === "manager" && body.delegatorUserId && body.delegatorUserId !== user.id) fail("Выбирайте только своих клиентов.", "FORBIDDEN");
      const terms = await validateTerms(c, user, delegatorId, body);
      const inserted = await c.query(`INSERT INTO delegations(delegator_user_id,assistant_user_id,status,
        starts_at,ends_at,created_by_user_id,basis) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,row_version`,
      [delegatorId, terms.assistantUserId, body.submit === false ? "draft" : "pending_approval", terms.startsAt, terms.endsAt, user.id, terms.basis]);
      id = inserted.rows[0]!.id;
      await replaceClients(c, id!, terms.clientGuids);
      await record(c, user, id!, "create", null, terms.basis);
      if (body.submit !== false) await record(c, user, id!, "submit", null, terms.basis);
      return { id, status: body.submit === false ? "draft" : "pending_approval", rowVersion: inserted.rows[0]!.row_version };
    }
    const locked = await c.query("SELECT * FROM delegations WHERE id=$1 FOR UPDATE", [id]);
    const d = locked.rows[0] as Row | undefined;
    if (!d) fail("Назначение не найдено.", "NOT_FOUND");
    if (body.rowVersion !== undefined && Number(body.rowVersion) !== d.row_version) fail("Назначение уже изменилось. Обновите его.", "CONFLICT");
    const before = await snapshot(c, id!);
    const comment = text(body.basis ?? body.reason, true);
    const proposal = before.proposal as Row | null;
    if (["approve", "reject", "return", "approve_change", "reject_change", "return_change", "revoke"].includes(action)) requireCoordinator(user);
    else requireAuthor(user, d);
    if (d.revoked_at || !["draft", "pending_approval", "active"].includes(d.status)) fail("Назначение уже завершено.", "CONFLICT");

    if (action === "edit" || action === "propose_change") {
      if (action === "edit" && d.status !== "draft") fail("Исправить можно только черновик или возврат.", "CONFLICT");
      if (action === "propose_change" && (d.status !== "active" || proposal || new Date(d.ends_at).getTime() <= Date.now())) {
        fail("Сейчас нельзя предложить новые условия.", "CONFLICT");
      }
      const terms = await validateTerms(c, user, d.delegator_user_id, body);
      if (action === "edit") {
        await c.query(`UPDATE delegations SET assistant_user_id=$2,starts_at=$3,ends_at=$4,basis=$5,workflow_state=NULL WHERE id=$1`,
        [id, terms.assistantUserId, terms.startsAt, terms.endsAt, terms.basis]);
        await replaceClients(c, id!, terms.clientGuids);
      } else {
        await lockClients(c, [...terms.clientGuids, ...before.clients.map((v: Row) => v.guid)]);
        await assertNoOverlap(c, id!, terms.clientGuids, terms.startsAt, terms.endsAt);
        const change = await c.query(`INSERT INTO delegation_change_requests(delegation_id,status,proposed_starts_at,
          proposed_ends_at,requested_by_user_id,proposed_assistant_user_id,basis)
          VALUES($1,'pending_approval',$2,$3,$4,$5,$6) RETURNING id`,
        [id, terms.startsAt, terms.endsAt, user.id, terms.assistantUserId, terms.basis]);
        await c.query(`INSERT INTO delegation_change_request_clients(change_request_id,guid_client)
          SELECT $1::uuid,unnest($2::uuid[])`, [change.rows[0]!.id, terms.clientGuids]);
      }
    } else if (action === "submit") {
      if (d.status !== "draft") fail("Отправить можно только черновик или возврат.", "CONFLICT");
      await validateTerms(c, user, d.delegator_user_id, {
        assistantUserId: d.assistant_user_id, startsAt: new Date(d.starts_at).toISOString(), endsAt: new Date(d.ends_at).toISOString(),
        clientGuids: before.clients.map((v: Row) => v.guid), basis: comment,
      });
      await c.query("UPDATE delegations SET status='pending_approval',workflow_state=NULL,basis=$2 WHERE id=$1", [id, comment]);
    } else if (action === "approve" || action === "approve_change") {
      if ((action === "approve" && d.status !== "pending_approval") ||
        (action === "approve_change" && (d.status !== "active" || !proposal))) fail("Заявка уже рассмотрена.", "CONFLICT");
      const source = action === "approve_change" ? proposal! : before;
      const terms = await validateTerms(c, user, d.delegator_user_id, {
        assistantUserId: source.assistant_user_id, startsAt: new Date(source.starts_at).toISOString(),
        endsAt: new Date(source.ends_at).toISOString(), clientGuids: source.clients.map((v: Row) => v.guid), basis: source.basis || comment,
      });
      await lockClients(c, [...terms.clientGuids, ...before.clients.map((v: Row) => v.guid)]);
      await assertNoOverlap(c, id!, terms.clientGuids, terms.startsAt, terms.endsAt);
      await replaceClients(c, id!, terms.clientGuids);
      await c.query(`UPDATE delegations SET status='active',assistant_user_id=$2,starts_at=$3,ends_at=$4,
        approved_by_user_id=$5,business_approver_user_id=$5,approved_at=NOW(),workflow_state=NULL,basis=$6 WHERE id=$1`,
      [id, terms.assistantUserId, terms.startsAt, terms.endsAt, user.id, terms.basis]);
      if (proposal) await c.query(`UPDATE delegation_change_requests SET status='approved',approved_by_user_id=$2,
        approved_at=NOW(),updated_at=NOW(),workflow_decision='approved' WHERE id=$1`, [proposal.id, user.id]);
    } else if (["reject_change", "return_change", "cancel_change"].includes(action)) {
      if (d.status !== "active" || !proposal) fail("Запрос изменений уже рассмотрен.", "CONFLICT");
      await lockClients(c, [...before.clients, ...proposal.clients].map((v: Row) => v.guid));
      await c.query(`UPDATE delegation_change_requests SET status=$2,workflow_decision=$3,
        rejected_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [proposal.id, action === "cancel_change" ? "superseded" : "rejected", action]);
    } else if (action === "return") {
      if (d.status !== "pending_approval") fail("Вернуть можно только заявку на согласовании.", "CONFLICT");
      await c.query("UPDATE delegations SET status='draft',workflow_state='returned' WHERE id=$1", [id]);
    } else if (action === "reject" || action === "cancel" || action === "revoke") {
      if (action === "reject" && d.status !== "pending_approval") fail("Отклонить можно только заявку.", "CONFLICT");
      if (action === "cancel" && !["draft", "pending_approval"].includes(d.status)) fail("Действующий доступ отзывает координатор.", "CONFLICT");
      if (action === "revoke" && d.status !== "active") fail("Отозвать можно только согласованное назначение.", "CONFLICT");
      await c.query(`UPDATE delegations SET status='revoked',workflow_state=$2,revoked_at=NOW(),
        revoked_by_user_id=$3,revoke_reason=$4 WHERE id=$1`,
      [id, action === "reject" ? "rejected" : action === "cancel" ? "cancelled" : null, user.id, comment]);
      await c.query("UPDATE delegation_change_requests SET status='superseded',updated_at=NOW() WHERE delegation_id=$1 AND status='pending_approval'", [id]);
    } else fail("Неизвестное действие.");
    await c.query("UPDATE delegations SET row_version=row_version+1,updated_at=NOW() WHERE id=$1", [id]);
    await record(c, user, id!, action, before, comment);
    const after = await snapshot(c, id!);
    return { id, status: after.status, rowVersion: after.row_version };
  });
}

function visibility(actor: AssignmentActor, params: unknown[]): string {
  if (actor.role === "coordinator" || actor.role === "director") return "TRUE";
  if (!["manager", "assistant", "rop"].includes(actor.role)) return "FALSE";
  params.push(actor.id);
  const p = "$" + params.length;
  if (actor.role === "manager") return `d.delegator_user_id=${p}::uuid`;
  if (actor.role === "assistant") return `d.assistant_user_id=${p}::uuid AND d.approved_by_user_id IS NOT NULL`;
  if (actor.role === "rop") return `(d.delegator_user_id=${p}::uuid OR EXISTS(SELECT 1 FROM rop_team_members tm
    WHERE tm.rop_user_id=${p}::uuid AND tm.member_user_id=d.delegator_user_id AND tm.revoked_at IS NULL))`;
  return "FALSE";
}
export async function listAssignments(actor: AssignmentActor, input: { page: number; q: string; status: string }) {
  const params: unknown[] = [];
  let where = visibility(actor, params);
  params.push("%" + input.q.replace(/[%_\\]/g, "\\$&") + "%");
  where += ` AND (m.full_name ILIKE $${params.length} OR a.full_name ILIKE $${params.length} OR d.id::text ILIKE $${params.length})`;
  if (input.status === "queue") where += ` AND (d.status='pending_approval' OR EXISTS(
    SELECT 1 FROM delegation_change_requests r WHERE r.delegation_id=d.id AND r.status='pending_approval'))`;
  if (input.status === "active") where += ` AND d.status='active' AND d.revoked_at IS NULL AND d.ends_at>NOW()`;
  if (input.status === "draft") where += " AND d.status='draft'";
  if (input.status === "archive") where += " AND (d.status IN('revoked','expired') OR (d.status='active' AND d.ends_at<=NOW()))";
  const from = `FROM delegations d JOIN users m ON m.id=d.delegator_user_id JOIN users a ON a.id=d.assistant_user_id WHERE ${where}`;
  const count = await query(`SELECT COUNT(*)::int AS total ${from}`, params);
  const result = await query(`SELECT d.*,m.full_name AS delegator_name,a.full_name AS assistant_name,
    (SELECT COUNT(*)::int FROM delegation_clients dc WHERE dc.delegation_id=d.id) AS client_count,
    EXISTS(SELECT 1 FROM delegation_change_requests r WHERE r.delegation_id=d.id AND r.status='pending_approval') AS pending_change
    ${from} ORDER BY d.created_at DESC,d.id DESC LIMIT 30 OFFSET $${params.length + 1}`, [...params, (input.page - 1) * 30]);
  const coordinators = await query("SELECT COUNT(*)::int AS count FROM users WHERE role='coordinator' AND status='active'");
  return { items: result.rows.map(presentStatus), total: count.rows[0]!.total, page: input.page, pageSize: 30, coordinatorCount: coordinators.rows[0]!.count };
}
function presentStatus(row: Row): Row {
  const result = enrichDelegationRow(row);
  const labels: Row = { returned: "Возвращено на уточнение", rejected: "Отклонено", cancelled: "Отменено" };
  return row.workflow_state && labels[row.workflow_state]
    ? { ...result, effective_status: row.workflow_state, effective_label: labels[row.workflow_state] } : result;
}
export async function assignmentDetail(actor: AssignmentActor, id: string) {
  const params: unknown[] = [];
  const where = visibility(actor, params);
  params.push(id);
  const allowed = await query(`SELECT 1 FROM delegations d WHERE (${where}) AND d.id=$${params.length}`, params);
  if (!allowed.rowCount) fail("Назначение не найдено.", "NOT_FOUND");
  return withTransaction(async c => {
    const d = await snapshot(c, id);
    const access = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role, delegatorUserId: d.delegator_user_id, entries: d.clients });
    d.clients = access.access === "visible" ? access.clients : null;
    d.clients_access = access.access;
    if (d.proposal) {
      const proposedAccess = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role, delegatorUserId: d.delegator_user_id, entries: d.proposal.clients });
      d.proposal.clients = proposedAccess.access === "visible" ? proposedAccess.clients : null;
    }
    const history = await c.query(`SELECT id,event_seq,changed_at,change_type,actor_role,actor_name,comment,snapshot,before_json
      FROM delegation_change_history WHERE delegation_id=$1 ORDER BY changed_at,event_seq`, [id]);
    // Assistants see access conditions, never proposal/history containing out-of-scope clients.
    if (actor.role === "assistant") {
      d.proposal = d.proposal ? { pending: true } : null;
      d.history = [];
    } else {
      d.history = [];
      for (const h of history.rows) {
        const { before_json, ...event } = h;
        const entries = [...(h.snapshot?.clients || []), ...(h.snapshot?.proposal?.clients || [])];
        const historicalAccess = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role, delegatorUserId: d.delegator_user_id, entries });
        d.history.push(historicalAccess.access === "visible" ? event : { ...event, snapshot: null });
      }
      const lastChange = [...history.rows].reverse().find(h =>
        ["propose_change", "approve_change", "reject_change", "return_change", "cancel_change"].includes(h.change_type));
      if (d.status === "active" && !d.proposal && lastChange?.change_type === "return_change" && lastChange.before_json?.proposal) {
        const returned = lastChange.before_json.proposal;
        const returnedAccess = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role, delegatorUserId: d.delegator_user_id, entries: returned.clients || [] });
        d.returnedProposal = { ...returned, clients: returnedAccess.access === "visible" ? returnedAccess.clients : null };
      }
    }
    d.pending_change = Boolean(d.proposal);
    d.canAuthor = isAuthor(actor, d);
    d.canReview = actor.role === "coordinator";
    return presentStatus(d);
  });
}
export async function assignmentActivity(actor: AssignmentActor, page: number, action: string, q: string) {
  if (!["coordinator", "director"].includes(actor.role)) fail("Журнал доступен координатору и директору.", "FORBIDDEN");
  const params: unknown[] = ["%" + q.replace(/[%_\\]/g, "\\$&") + "%"];
  let where = `h.actor_role='coordinator' AND (h.actor_name ILIKE $1 OR h.comment ILIKE $1 OR
    h.snapshot->>'delegator_name' ILIKE $1 OR h.snapshot->>'assistant_name' ILIKE $1)`;
  if (action) { params.push(action); where += ` AND h.change_type=$${params.length}`; }
  const count = await query(`SELECT COUNT(*)::int AS total FROM delegation_change_history h WHERE ${where}`, params);
  const result = await query<Row>(`SELECT h.id,h.delegation_id,h.changed_at,h.change_type,h.actor_role,h.actor_name,h.comment,h.snapshot
    FROM delegation_change_history h WHERE ${where} ORDER BY h.changed_at DESC,h.event_seq DESC LIMIT 30 OFFSET $${params.length + 1}`,
  [...params, (page - 1) * 30]);
  // Director sees the activity but snapshots still respect client visibility/explicit denials.
  for (const row of result.rows) {
    if (row.snapshot) {
      const entries = [...(row.snapshot.clients || []), ...(row.snapshot.proposal?.clients || [])];
      const access = await assignmentClientsAccess({ actorUserId: actor.id, actorRole: actor.role, delegatorUserId: row.snapshot.delegator_user_id, entries });
      if (access.access !== "visible") row.snapshot = null;
    }
  }
  return { items: result.rows, total: count.rows[0]!.total, page, pageSize: 30 };
}

export async function assignmentManagers(actor: AssignmentActor) {
  requireCoordinator(actor);
  const result = await query(`SELECT id,full_name,email FROM users WHERE status='active' AND role IN('manager','rop') ORDER BY full_name,id`);
  return result.rows;
}
export async function assignmentPicker(actor: AssignmentActor, managerId: string, input: Row) {
  if (!(actor.role === "coordinator" || actor.role === "manager" && actor.id === managerId)) fail("Нет доступа к клиентам менеджера.", "NOT_FOUND");
  const ctx = await loadAccessContext(managerId);
  const actorCtx = await loadAccessContext(actor.id);
  if (!["manager", "rop"].includes(ctx.role)) fail("Выберите передающего менеджера.");
  let scope = v3EntityAssignmentScope(ctx, "le", "legal");
  if (actorCtx.explicitlyDeniedAll) scope = { clause: "FALSE", params: [] };
  const params = [...scope.params];
  const retailScope = v3EntityAssignmentScope(ctx, "ro", "retail");
  const retailOffset = params.length;
  const retailSql = retailScope.clause.replace(/\$(\d+)/g, (_, n: string) => "$" + (Number(n) + retailOffset));
  params.push(...retailScope.params);
  const groupKey = readableGroupKey(ctx, params);
  params.push(ctx.employeeId);
  const employeeP = "$" + params.length;
  // Month missing => last imported month; missing sales remain NULL, never zero.
  const monthResult = await query("SELECT to_char(MAX(sale_month),'YYYY-MM') AS month FROM onec_v3_legal_sales_lines");
  const month = input.month || monthResult.rows[0]?.month || null;
  params.push(month ? month + "-01" : null);
  const monthP = "$" + params.length;
  params.push(actor.id);
  const actorP = "$" + params.length;
  params.push(input.startsAt || null, input.endsAt || null, input.excludeId || null);
  const startP = "$" + (params.length - 2), endP = "$" + (params.length - 1), excludeP = "$" + params.length;
  const base = `WITH scoped AS (
    SELECT le.guid_client,le.name_client,le.telephone,
      COALESCE(${groupKey},'legal:'||le.guid_client::text) AS group_key,
      le.name_holding,${LEGAL_CITY_SQL} AS city,le.type_category->>'nameCategory' AS category,
      le.inn,le.other_fields,le.guid_holding,
      (SELECT SUM(sl.income) FROM onec_v3_legal_sales_lines sl WHERE sl.legal_guid=le.guid_client
        AND sl.sale_month=${monthP}::date) AS sales,
      (SELECT COUNT(*)::int FROM onec_v3_retail_outlets ro WHERE ro.guid_holding=le.guid_holding AND (${retailSql})
        AND lower(${v3JsonManagerField("ro", "guidManager")})=lower(${employeeP}::text)
        AND NOT EXISTS(SELECT 1 FROM access_denials ad WHERE ad.user_id=${actorP}::uuid AND ad.revoked_at IS NULL
          AND (ad.scope_type='all_clients' OR ad.object_id=ro.guid_store))) AS tt_count,
      CASE WHEN ${startP}::timestamptz IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM delegations d
        WHERE d.status='active' AND d.revoked_at IS NULL AND d.id IS DISTINCT FROM ${excludeP}::uuid AND (
          (d.starts_at<${endP}::timestamptz AND ${startP}::timestamptz<d.ends_at
            AND EXISTS(SELECT 1 FROM delegation_clients dc WHERE dc.delegation_id=d.id AND dc.guid_client=le.guid_client))
          OR EXISTS(SELECT 1 FROM delegation_change_requests r JOIN delegation_change_request_clients rc ON rc.change_request_id=r.id
            WHERE r.delegation_id=d.id AND r.status='pending_approval' AND rc.guid_client=le.guid_client
              AND r.proposed_starts_at<${endP}::timestamptz AND ${startP}::timestamptz<r.proposed_ends_at)
        )) END AS conflict
    FROM onec_v3_legal_entities le WHERE (${scope.clause})
      AND lower(${v3JsonManagerField("le", "guidManager")})=lower(${employeeP}::text)
      AND NOT EXISTS(
      SELECT 1 FROM access_denials ad WHERE ad.user_id=${actorP}::uuid AND ad.revoked_at IS NULL
        AND (ad.scope_type='all_clients' OR ad.object_id=le.guid_client))
  ), grouped AS (
    SELECT group_key AS key,array_agg(guid_client ORDER BY guid_client) AS guids,
      CASE WHEN group_key LIKE 'holding:%' THEN COALESCE(MAX(NULLIF(name_holding,'')),MIN(name_client)) ELSE MIN(name_client) END AS name,
      string_agg(DISTINCT city,', ') AS city,string_agg(DISTINCT category,', ') AS category,
      COUNT(*)::int AS legal_count,MAX(tt_count) AS tt_count,CASE WHEN BOOL_AND(sales IS NOT NULL) THEN SUM(sales) END AS sales,
      BOOL_OR(conflict) AS conflict,
      string_agg(name_client||' '||COALESCE(inn,'')||' '||guid_client::text||' '||COALESCE(telephone::text,'')||' '||COALESCE(other_fields::text,''),' ') AS search_text
    FROM scoped GROUP BY group_key
  )`;
  let where = "TRUE";
  for (const [key, column] of [["q", "(name||' '||COALESCE(city,'')||' '||search_text)"], ["city", "COALESCE(city,'')"], ["category", "COALESCE(category,'')"]]) {
    if (input[key]) { params.push("%" + input[key].replace(/[%_\\]/g, "\\$&") + "%"); where += ` AND ${column} ILIKE $${params.length}`; }
  }
  if (input.min !== undefined) { params.push(input.min); where += ` AND sales >= $${params.length}::numeric`; }
  if (input.max !== undefined) { params.push(input.max); where += ` AND sales <= $${params.length}::numeric`; }
  if (input.legalMin) { params.push(input.legalMin); where += ` AND legal_count >= $${params.length}::int`; }
  if (input.retailMin) { params.push(input.retailMin); where += ` AND tt_count >= $${params.length}::int`; }
  if (input.conflict === "busy") where += " AND conflict";
  if (input.conflict === "free") where += " AND NOT conflict";
  const count = await query(base + ` SELECT COUNT(*)::int AS total FROM grouped WHERE ${where}`, params);
  const order = input.sort === "sales_desc" ? "sales DESC NULLS LAST,name,key" : input.sort === "sales_asc" ? "sales ASC NULLS LAST,name,key" : "name,key";
  const items = await query(base + ` SELECT key,guids,name,city,category,legal_count,tt_count,sales::text,conflict FROM grouped
    WHERE ${where} ORDER BY ${order} LIMIT 50 OFFSET $${params.length + 1}`, [...params, (input.page - 1) * 50]);
  const months = await query("SELECT DISTINCT to_char(sale_month,'YYYY-MM') AS month FROM onec_v3_legal_sales_lines ORDER BY month DESC");
  return { items: items.rows, total: count.rows[0]!.total, page: input.page, pageSize: 50, month, months: months.rows.map(r => r.month) };
}

export async function assignmentNotifications(actor: AssignmentActor, page = 1) {
  const params: unknown[] = [];
  const where = ["manager", "assistant", "coordinator", "director"].includes(actor.role) ? visibility(actor, params) : "FALSE";
  params.push(actor.id);
  // Generate time-based notices idempotently while the cabinet is open; no external scheduler or channel.
  const due = await query<Row>(`WITH due AS (SELECT d.id,d.row_version,d.starts_at,d.ends_at,d.approved_at,
    CASE WHEN d.ends_at<=NOW() THEN 'expired'
      WHEN d.starts_at<=NOW() AND d.starts_at>NOW()-INTERVAL '1 day'
        AND d.approved_at<d.starts_at AND d.ends_at>=NOW()+INTERVAL '24 hours' THEN 'started'
      ELSE 'expiring' END AS kind
    FROM delegations d WHERE (${where}) AND d.status='active' AND d.revoked_at IS NULL
      AND d.ends_at>NOW()-INTERVAL '7 days'
      AND (d.ends_at<NOW()+INTERVAL '24 hours' OR (d.starts_at<=NOW() AND d.starts_at>NOW()-INTERVAL '1 day' AND d.approved_at<d.starts_at))
    ), events AS (
      SELECT due.*,id::text||':'||trunc(EXTRACT(EPOCH FROM starts_at)*1000)::bigint::text
        ||':'||trunc(EXTRACT(EPOCH FROM ends_at)*1000)::bigint::text||':'||kind AS event_key FROM due
    ) SELECT events.* FROM events WHERE NOT EXISTS(
      SELECT 1 FROM assistant_assignment_notifications n
      WHERE n.user_id=$${params.length}::uuid AND n.event_key=events.event_key
    ) ORDER BY ends_at DESC,id LIMIT 100`, params);
  for (const d of due.rows) {
    const titles: Row = { expired: "Срок назначения завершён", started: "Начался период доступа", expiring: "Срок назначения заканчивается в течение суток" };
    await query(`INSERT INTO assistant_assignment_notifications(user_id,delegation_id,event_key,kind,title,message)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_key) DO NOTHING`,
    [actor.id, d.id, d.event_key, d.kind, titles[d.kind],
      "Назначение №" + d.id.slice(0, 8) + ". Окончание: " + new Date(d.ends_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК."]);
  }
  const items = await query(`SELECT id,delegation_id,kind,title,message,created_at,read_at FROM assistant_assignment_notifications
    WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $2`, [actor.id, (page - 1) * 30]);
  const count = await query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE read_at IS NULL)::int AS unread
    FROM assistant_assignment_notifications WHERE user_id=$1`, [actor.id]);
  const boundaries = actor.role === "assistant" ? await query(`SELECT MIN(t.at) AS next FROM delegations d
    CROSS JOIN LATERAL (VALUES(d.starts_at),(d.ends_at)) t(at)
    WHERE d.assistant_user_id=$1 AND d.status='active' AND d.revoked_at IS NULL AND t.at>NOW()`, [actor.id]) : null;
  const revision = actor.role === "assistant" ? await query(`SELECT md5(COALESCE(string_agg(
    d.id::text||':'||d.row_version||':'||(d.starts_at<=NOW() AND d.ends_at>NOW())::text||':'||
    EXISTS(SELECT 1 FROM delegation_change_requests r WHERE r.delegation_id=d.id AND r.status='pending_approval')::text,
    ',' ORDER BY d.id),'')) AS value FROM delegations d WHERE d.assistant_user_id=$1`, [actor.id]) : null;
  return { items: items.rows, ...count.rows[0], page, pageSize: 30, serverNow: new Date().toISOString(),
    nextScopeChangeAt: boundaries?.rows[0]?.next || null, scopeRevision: revision?.rows[0]?.value || null };
}
export async function readAssignmentNotifications(actor: AssignmentActor, id?: string) {
  if (id) {
    const result = await query("UPDATE assistant_assignment_notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1 AND id=$2 RETURNING id", [actor.id, id]);
    if (!result.rowCount) fail("Уведомление не найдено.", "NOT_FOUND");
  } else await query("UPDATE assistant_assignment_notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL", [actor.id]);
}
