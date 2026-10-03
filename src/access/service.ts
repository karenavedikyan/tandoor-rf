import type { TransactionClient } from "./db";
import { AccessServiceError, withTransaction } from "./db";
import { ACCESS_AUDIT_ACTIONS } from "./constants";
import {
  assertClientsExist,
  canBusinessApproveDelegation,
  coordinatorAssignedToDelegatorTeam,
  getActiveUser,
  getDelegationForUpdate,
  getEmployeeId,
  ropManagesDelegator,
} from "./authorization";
import { assertDelegatorEffectiveClientAccess } from "./delegator-access";
import {
  assertActorCanViewDelegationClientsForApproval,
  resolveDelegationClientsAccess,
  type DelegationClientEntry,
} from "./delegation-client-visibility";
import { enrichDelegationRow } from "./delegation-status";
import { listDelegatorClientsPicker } from "./delegator-client-picker";

let testFaultAfterDelegationClients = false;

type ConcurrencyHoldPoint = "approve" | "revoke" | "propose-change" | "approve-change";

type ConcurrencyHoldState = {
  point: ConcurrencyHoldPoint;
  release: () => void;
  wait: Promise<void>;
  acquired?: () => void;
  acquiredPromise?: Promise<void>;
};

const CONCURRENCY_HOLD_KEY = "__tandoorRfAccessConcurrencyHold";

function getConcurrencyHoldState(): ConcurrencyHoldState | null {
  return (
    ((globalThis as Record<string, unknown>)[CONCURRENCY_HOLD_KEY] as
      | ConcurrencyHoldState
      | undefined) ?? null
  );
}

function setConcurrencyHoldState(state: ConcurrencyHoldState | null): void {
  if (state === null) {
    delete (globalThis as Record<string, unknown>)[CONCURRENCY_HOLD_KEY];
    return;
  }
  (globalThis as Record<string, unknown>)[CONCURRENCY_HOLD_KEY] = state;
}

/** @internal test-only fault injection */
export function setTestFaultAfterDelegationClients(enabled: boolean): void {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  testFaultAfterDelegationClients = enabled;
}

/** @internal test-only concurrency barrier */
export function armConcurrencyHold(point: ConcurrencyHoldPoint): void {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  let releaseFn!: () => void;
  const wait = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  let acquiredResolve!: () => void;
  const acquiredPromise = new Promise<void>((resolve) => {
    acquiredResolve = resolve;
  });
  setConcurrencyHoldState({
    point,
    release: releaseFn,
    wait,
    acquired: acquiredResolve,
    acquiredPromise,
  });
}

/** @internal test-only concurrency barrier */
export function releaseConcurrencyHold(): void {
  getConcurrencyHoldState()?.release();
  setConcurrencyHoldState(null);
}

/** @internal test-only: resolves once the armed hold point is reached inside a transaction lock */
export function waitForConcurrencyHoldAcquired(): Promise<void> {
  const hold = getConcurrencyHoldState();
  if (!hold?.acquiredPromise) {
    throw new Error("Concurrency hold is not armed.");
  }
  return hold.acquiredPromise;
}

async function maybeHoldConcurrencyAt(point: ConcurrencyHoldPoint): Promise<void> {
  const hold = getConcurrencyHoldState();
  if (hold?.point === point) {
    hold.acquired?.();
    hold.acquired = undefined;
    await hold.wait;
  }
}

async function loadDelegationClientEntries(delegationIds: string[]): Promise<Map<string, DelegationClientEntry[]>> {
  if (delegationIds.length === 0) {
    return new Map();
  }
  const { query } = await import("../db/pool");
  const result = await query<{
    delegation_id: string;
    guid: string;
    name: string;
  }>(
    `
      SELECT
        dc.delegation_id::text,
        oc.guid_client::text AS guid,
        oc.name_client AS name
      FROM delegation_clients dc
      JOIN onec_clients oc ON oc.guid_client = dc.guid_client
      WHERE dc.delegation_id = ANY($1::uuid[])
      ORDER BY oc.name_client ASC
    `,
    [delegationIds],
  );
  const grouped = new Map<string, DelegationClientEntry[]>();
  for (const row of result.rows) {
    const list = grouped.get(row.delegation_id) ?? [];
    list.push({ guid: row.guid, name: row.name });
    grouped.set(row.delegation_id, list);
  }
  return grouped;
}

async function enrichOverviewDelegations(
  actorUserId: string,
  actorRole: string,
  rows: Array<Record<string, unknown>>,
) {
  const grouped = await loadDelegationClientEntries(rows.map((row) => String(row.id)));
  const enriched = [];
  for (const row of rows) {
    const delegationId = String(row.id);
    const delegatorUserId = String(row.delegator_user_id ?? actorUserId);
    const entries = grouped.get(delegationId) ?? [];
    const access = await resolveDelegationClientsAccess({
      actorUserId,
      actorRole,
      delegatorUserId,
      entries,
    });
    enriched.push(
      enrichDelegationRow({
        ...row,
        client_count: access.access === "visible" ? entries.length : null,
        clients_access: access.access,
        clients_access_message: access.access === "restricted" ? access.message : null,
      }),
    );
  }
  return enriched;
}

type AuditInput = {
  client: TransactionClient;
  actorUserId: string;
  businessActorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  basis?: string | null;
};

async function writeAudit(input: AuditInput): Promise<void> {
  await input.client.query(
    `
      INSERT INTO access_audit_log (
        actor_user_id,
        business_actor_user_id,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        basis
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8)
    `,
    [
      input.actorUserId,
      input.businessActorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.basis ?? null,
    ],
  );
}

async function insertDelegationClients(
  client: TransactionClient,
  delegationId: string,
  clientGuids: string[],
): Promise<void> {
  for (const guid of clientGuids) {
    await client.query(
      `
        INSERT INTO delegation_clients (delegation_id, guid_client)
        VALUES ($1::uuid, $2::uuid)
      `,
      [delegationId, guid],
    );
  }
}

async function recordDelegationHistory(
  client: TransactionClient,
  delegationId: string,
  changedByUserId: string,
  changeType: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await client.query(
    `
      INSERT INTO delegation_change_history (
        delegation_id, changed_by_user_id, change_type, before_json, after_json
      )
      VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb)
    `,
    [
      delegationId,
      changedByUserId,
      changeType,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  );
}

export async function createEmployeeLink(input: {
  actorUserId: string;
  userId: string;
  employeeId: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    await getActiveUser(client, input.userId);
    const active = await client.query(
      `
        SELECT id::text FROM user_onec_employee_links
        WHERE user_id = $1::uuid AND revoked_at IS NULL
      `,
      [input.userId],
    );
    if (active.rows[0]) {
      throw new AccessServiceError("У пользователя уже есть активная связь.", "CONFLICT");
    }
    const conflict = await client.query(
      `
        SELECT user_id::text FROM user_onec_employee_links
        WHERE employee_id = $1::uuid AND revoked_at IS NULL
      `,
      [input.employeeId],
    );
    if (conflict.rows[0]) {
      throw new AccessServiceError(
        "Этот ID сотрудника 1С уже привязан к другому пользователю.",
        "CONFLICT",
      );
    }

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO user_onec_employee_links (
          user_id, employee_id, basis, confirmed_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
        RETURNING id::text AS id
      `,
      [input.userId, input.employeeId, input.basis, input.actorUserId],
    );

    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.EMPLOYEE_LINK_CREATE,
      entityType: "user_onec_employee_link",
      entityId: inserted.rows[0]!.id,
      after: input,
      basis: input.basis,
    });

    return { id: inserted.rows[0]!.id };
  });
}

export async function revokeEmployeeLink(input: {
  actorUserId: string;
  linkId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const before = await client.query(
      "SELECT * FROM user_onec_employee_links WHERE id = $1::uuid FOR UPDATE",
      [input.linkId],
    );
    const row = before.rows[0];
    if (!row || row.revoked_at) {
      throw new AccessServiceError("Связь не найдена.", "NOT_FOUND");
    }

    const updated = await client.query(
      `
        UPDATE user_onec_employee_links
        SET revoked_at = NOW(), revoked_by_user_id = $2::uuid, revoke_reason = $3, updated_at = NOW()
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.linkId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Связь не найдена.", "NOT_FOUND");
    }

    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.EMPLOYEE_LINK_REVOKE,
      entityType: "user_onec_employee_link",
      entityId: input.linkId,
      before: row,
      after: { revoked: true, reason: input.reason },
      basis: input.basis,
    });
  });
}

export async function createAccessGrant(input: {
  actorUserId: string;
  userId: string;
  objectId: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    await getActiveUser(client, input.userId);
    await assertClientsExist(client, [input.objectId]);
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
        VALUES ($1::uuid, 'client', $2::uuid, $3, $4::uuid)
        RETURNING id::text AS id
      `,
      [input.userId, input.objectId, input.basis, input.actorUserId],
    );
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.GRANT_CREATE,
      entityType: "access_grant",
      entityId: inserted.rows[0]!.id,
      after: input,
      basis: input.basis,
    });
    return { id: inserted.rows[0]!.id };
  });
}

export async function revokeAccessGrant(input: {
  actorUserId: string;
  grantId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const before = await client.query(
      "SELECT * FROM access_grants WHERE id = $1::uuid FOR UPDATE",
      [input.grantId],
    );
    const row = before.rows[0];
    if (!row || row.revoked_at) {
      throw new AccessServiceError("Назначение не найдено.", "NOT_FOUND");
    }
    const updated = await client.query(
      `
        UPDATE access_grants
        SET revoked_at = NOW(), revoked_by_user_id = $2::uuid, revoke_reason = $3
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.grantId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Назначение не найдено.", "NOT_FOUND");
    }
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.GRANT_REVOKE,
      entityType: "access_grant",
      entityId: input.grantId,
      before: row,
      after: { revoked: true },
      basis: input.basis,
    });
  });
}

export async function addRopTeamMember(input: {
  actorUserId: string;
  ropUserId: string;
  memberUserId: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    const rop = await getActiveUser(client, input.ropUserId);
    if (rop.role !== "rop") {
      throw new AccessServiceError("Пользователь не является РОП.", "VALIDATION");
    }
    await getActiveUser(client, input.memberUserId);
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO rop_team_members (
          rop_user_id, member_user_id, basis, created_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
        RETURNING id::text AS id
      `,
      [input.ropUserId, input.memberUserId, input.basis, input.actorUserId],
    );
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.ROP_TEAM_ADD,
      entityType: "rop_team_member",
      entityId: inserted.rows[0]!.id,
      after: input,
      basis: input.basis,
    });
    return { id: inserted.rows[0]!.id };
  });
}

export async function revokeRopTeamMember(input: {
  actorUserId: string;
  teamMemberId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const before = await client.query(
      "SELECT * FROM rop_team_members WHERE id = $1::uuid FOR UPDATE",
      [input.teamMemberId],
    );
    const row = before.rows[0];
    if (!row || row.revoked_at) {
      throw new AccessServiceError("Запись команды не найдена.", "NOT_FOUND");
    }
    const updated = await client.query(
      `
        UPDATE rop_team_members
        SET revoked_at = NOW(), revoked_by_user_id = $2::uuid, revoke_reason = $3
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.teamMemberId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Запись команды не найдена.", "NOT_FOUND");
    }
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.ROP_TEAM_REVOKE,
      entityType: "rop_team_member",
      entityId: input.teamMemberId,
      before: row,
      after: { revoked: true },
      basis: input.basis,
    });
  });
}

export async function createAccessDenial(input: {
  actorUserId: string;
  userId: string;
  scopeType: "client" | "all_clients";
  objectId?: string | null;
  reason: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    await getActiveUser(client, input.userId);
    if (input.scopeType === "client") {
      if (!input.objectId) {
        throw new AccessServiceError("Для запрета клиента нужен objectId.", "VALIDATION");
      }
      await assertClientsExist(client, [input.objectId]);
    }
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO access_denials (
          user_id, scope_type, object_id, reason, basis, created_by_user_id
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid)
        RETURNING id::text AS id
      `,
      [
        input.userId,
        input.scopeType,
        input.scopeType === "client" ? input.objectId : null,
        input.reason,
        input.basis,
        input.actorUserId,
      ],
    );
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: "access_denial.create",
      entityType: "access_denial",
      entityId: inserted.rows[0]!.id,
      after: input,
      basis: input.basis,
    });
    return { id: inserted.rows[0]!.id };
  });
}

export async function revokeAccessDenial(input: {
  actorUserId: string;
  denialId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const before = await client.query(
      "SELECT * FROM access_denials WHERE id = $1::uuid FOR UPDATE",
      [input.denialId],
    );
    const row = before.rows[0];
    if (!row || row.revoked_at) {
      throw new AccessServiceError("Запрет не найден.", "NOT_FOUND");
    }
    const updated = await client.query(
      `
        UPDATE access_denials
        SET revoked_at = NOW(), revoked_by_user_id = $2::uuid, revoke_reason = $3
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.denialId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Запрет не найден.", "NOT_FOUND");
    }
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: "access_denial.revoke",
      entityType: "access_denial",
      entityId: input.denialId,
      before: row,
      after: { revoked: true },
      basis: input.basis,
    });
  });
}

export async function createDelegationRequest(input: {
  actorUserId: string;
  actorRole: string;
  delegatorUserId: string;
  assistantUserId: string;
  clientGuids: string[];
  startsAt: string;
  endsAt: string;
  submit: boolean;
  basis: string;
}): Promise<{ id: string; status: string }> {
  return withTransaction(async (client) => {
    const actor = await getActiveUser(client, input.actorUserId);
    const delegator = await getActiveUser(client, input.delegatorUserId);
    const assistant = await getActiveUser(client, input.assistantUserId);

    if (assistant.role !== "assistant") {
      throw new AccessServiceError("Получатель замещения должен иметь роль assistant.", "VALIDATION");
    }

    if (delegator.role !== "manager" && delegator.role !== "rop") {
      throw new AccessServiceError("Передающий должен быть менеджером или РОП.", "VALIDATION");
    }

    if (input.clientGuids.length === 0) {
      throw new AccessServiceError("Нужен хотя бы один клиент.", "VALIDATION");
    }

    if (input.actorRole === "manager") {
      if (input.actorUserId !== input.delegatorUserId) {
        throw new AccessServiceError("Менеджер может создавать замещение только для себя.", "FORBIDDEN");
      }
    } else if (input.actorRole === "rop") {
      const allowed = await ropManagesDelegator(client, input.actorUserId, input.delegatorUserId);
      if (!allowed) {
        throw new AccessServiceError("РОП может создавать замещение только для своей команды.", "FORBIDDEN");
      }
    } else if (input.actorRole === "coordinator") {
      const allowed = await coordinatorAssignedToDelegatorTeam(
        client,
        input.actorUserId,
        input.delegatorUserId,
      );
      if (!allowed) {
        throw new AccessServiceError("Координатор не назначен на команду передающего.", "FORBIDDEN");
      }
    } else if (input.actorRole !== "admin") {
      throw new AccessServiceError("Недостаточно прав для создания замещения.", "FORBIDDEN");
    }

    await assertClientsExist(client, input.clientGuids);
    await assertDelegatorEffectiveClientAccess(client, input.delegatorUserId, input.clientGuids);

    const status = input.submit ? "pending_approval" : "draft";
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO delegations (
          delegator_user_id,
          assistant_user_id,
          status,
          starts_at,
          ends_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::timestamptz)
        RETURNING id::text AS id
      `,
      [
        input.delegatorUserId,
        input.assistantUserId,
        status,
        input.startsAt,
        input.endsAt,
      ],
    );
    const delegationId = inserted.rows[0]!.id;
    await insertDelegationClients(client, delegationId, input.clientGuids);
    if (testFaultAfterDelegationClients) {
      throw new AccessServiceError("Тестовый сбой записи клиентов замещения.", "CONFLICT");
    }
    await recordDelegationHistory(client, delegationId, input.actorUserId, "create", null, {
      status,
      clientGuids: input.clientGuids,
    });
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.DELEGATION_CREATE,
      entityType: "delegation",
      entityId: delegationId,
      after: { ...input, status },
      basis: input.basis,
    });

    return { id: delegationId, status };
  });
}

export async function submitDelegation(input: {
  actorUserId: string;
  actorRole: string;
  delegationId: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const delegation = await getDelegationForUpdate(client, input.delegationId);
    if (delegation.status !== "draft") {
      throw new AccessServiceError("Отправить можно только черновик.", "CONFLICT");
    }
    await assertCanManageDelegation(client, input.actorUserId, input.actorRole, delegation);

    const updated = await client.query(
      `
        UPDATE delegations
        SET status = 'pending_approval', updated_at = NOW(), row_version = row_version + 1
        WHERE id = $1::uuid AND status = 'draft' AND revoked_at IS NULL
      `,
      [input.delegationId],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Не удалось отправить замещение.", "CONFLICT");
    }
    await recordDelegationHistory(client, input.delegationId, input.actorUserId, "submit", delegation, {
      status: "pending_approval",
    });
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.DELEGATION_SUBMIT,
      entityType: "delegation",
      entityId: input.delegationId,
      before: delegation,
      after: { status: "pending_approval" },
      basis: input.basis,
    });
  });
}

async function assertCanManageDelegation(
  client: TransactionClient,
  actorUserId: string,
  actorRole: string,
  delegation: { delegator_user_id: string },
): Promise<void> {
  if (actorRole === "admin") {
    return;
  }
  if (actorRole === "manager" && actorUserId === delegation.delegator_user_id) {
    return;
  }
  if (actorRole === "rop") {
    const allowed = await ropManagesDelegator(client, actorUserId, delegation.delegator_user_id);
    if (allowed) {
      return;
    }
  }
  if (actorRole === "coordinator") {
    const allowed = await coordinatorAssignedToDelegatorTeam(
      client,
      actorUserId,
      delegation.delegator_user_id,
    );
    if (allowed) {
      return;
    }
  }
  if (actorRole === "director") {
    const actor = await getActiveUser(client, actorUserId);
    const allowed = await canBusinessApproveDelegation(
      client,
      actor,
      delegation.delegator_user_id,
    );
    if (allowed) {
      return;
    }
  }
  throw new AccessServiceError("Недостаточно прав для управления замещением.", "FORBIDDEN");
}

export async function approveDelegationRequest(input: {
  actorUserId: string;
  actorRole: string;
  delegationId: string;
  basis: string;
  businessApproverUserId?: string | null;
  decisionReference?: string | null;
}): Promise<void> {
  return withTransaction(async (client) => {
    const delegation = await getDelegationForUpdate(client, input.delegationId);
    await maybeHoldConcurrencyAt("approve");
    if (delegation.status !== "pending_approval" || delegation.revoked_at) {
      throw new AccessServiceError("Замещение недоступно для согласования.", "CONFLICT");
    }

    let businessApproverId: string;
    let actorUserId = input.actorUserId;

    if (input.actorRole === "admin") {
      if (!input.businessApproverUserId) {
        throw new AccessServiceError(
          "Администратор должен указать businessApproverUserId уполномоченного руководителя.",
          "VALIDATION",
        );
      }
      if (!input.decisionReference?.trim()) {
        throw new AccessServiceError(
          "Администратор должен указать decisionReference — идентификатор внешнего решения.",
          "VALIDATION",
        );
      }
      const approver = await getActiveUser(client, input.businessApproverUserId);
      const allowed = await canBusinessApproveDelegation(
        client,
        approver,
        delegation.delegator_user_id,
      );
      if (!allowed) {
        throw new AccessServiceError("Указанный согласующий не уполномочен.", "FORBIDDEN");
      }
      businessApproverId = approver.id;
    } else {
      const actor = await getActiveUser(client, input.actorUserId);
      const allowed = await canBusinessApproveDelegation(
        client,
        actor,
        delegation.delegator_user_id,
      );
      if (!allowed) {
        throw new AccessServiceError("Недостаточно прав для согласования.", "FORBIDDEN");
      }
      businessApproverId = actor.id;
    }

    const clientRows = await client.query<{ guid_client: string; name_client: string }>(
      `
        SELECT oc.guid_client::text, oc.name_client
        FROM delegation_clients dc
        JOIN onec_clients oc ON oc.guid_client = dc.guid_client
        WHERE dc.delegation_id = $1::uuid
      `,
      [input.delegationId],
    );
    const clientGuids = clientRows.rows.map((row) => row.guid_client);
    await assertDelegatorEffectiveClientAccess(client, delegation.delegator_user_id, clientGuids);
    await assertActorCanViewDelegationClientsForApproval({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      delegatorUserId: delegation.delegator_user_id,
      entries: clientRows.rows.map((row) => ({
        guid: row.guid_client,
        name: row.name_client,
      })),
    });

    const updated = await client.query(
      `
        UPDATE delegations
        SET
          status = 'active',
          approved_by_user_id = $2::uuid,
          business_approver_user_id = $2::uuid,
          approved_at = NOW(),
          updated_at = NOW(),
          row_version = row_version + 1
        WHERE id = $1::uuid
          AND status = 'pending_approval'
          AND revoked_at IS NULL
      `,
      [input.delegationId, businessApproverId],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Замещение не согласовано.", "CONFLICT");
    }

    await recordDelegationHistory(client, input.delegationId, actorUserId, "approve", delegation, {
      status: "active",
      businessApproverId,
    });
    const auditBasis =
      input.actorRole === "admin" && input.decisionReference
        ? `[decision:${input.decisionReference.trim()}] ${input.basis}`
        : input.basis;

    await writeAudit({
      client,
      actorUserId,
      businessActorUserId: businessApproverId,
      action: ACCESS_AUDIT_ACTIONS.DELEGATION_APPROVE,
      entityType: "delegation",
      entityId: input.delegationId,
      before: delegation,
      after: { status: "active", businessApproverId, decisionReference: input.decisionReference ?? null },
      basis: auditBasis,
    });
  });
}

export async function revokeDelegationRequest(input: {
  actorUserId: string;
  actorRole: string;
  delegationId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const delegation = await getDelegationForUpdate(client, input.delegationId);
    await maybeHoldConcurrencyAt("revoke");
    if (delegation.revoked_at) {
      throw new AccessServiceError("Замещение уже отозвано.", "CONFLICT");
    }
    await assertCanManageDelegation(client, input.actorUserId, input.actorRole, delegation);

    const updated = await client.query(
      `
        UPDATE delegations
        SET
          status = 'revoked',
          revoked_by_user_id = $2::uuid,
          revoked_at = NOW(),
          revoke_reason = $3,
          updated_at = NOW(),
          row_version = row_version + 1
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.delegationId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Замещение не отозвано.", "CONFLICT");
    }

    await recordDelegationHistory(client, input.delegationId, input.actorUserId, "revoke", delegation, {
      status: "revoked",
      reason: input.reason,
    });
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.DELEGATION_REVOKE,
      entityType: "delegation",
      entityId: input.delegationId,
      before: delegation,
      after: { status: "revoked", reason: input.reason },
      basis: input.basis,
    });
  });
}

export async function proposeDelegationChange(input: {
  actorUserId: string;
  actorRole: string;
  delegationId: string;
  clientGuids: string[];
  startsAt: string;
  endsAt: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    const delegation = await getDelegationForUpdate(client, input.delegationId);
    await maybeHoldConcurrencyAt("propose-change");
    if (delegation.status !== "active" || delegation.revoked_at) {
      throw new AccessServiceError("Изменять можно только действующее согласованное замещение.", "CONFLICT");
    }
    await assertCanManageDelegation(client, input.actorUserId, input.actorRole, delegation);
    await assertClientsExist(client, input.clientGuids);
    await assertDelegatorEffectiveClientAccess(client, delegation.delegator_user_id, input.clientGuids);

    await client.query(
      `
        SELECT id
        FROM delegation_change_requests
        WHERE delegation_id = $1::uuid AND status = 'pending_approval'
        FOR UPDATE
      `,
      [input.delegationId],
    );
    await client.query(
      `
        UPDATE delegation_change_requests
        SET status = 'superseded', updated_at = NOW()
        WHERE delegation_id = $1::uuid AND status = 'pending_approval'
      `,
      [input.delegationId],
    );

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO delegation_change_requests (
          delegation_id,
          status,
          proposed_starts_at,
          proposed_ends_at,
          requested_by_user_id
        )
        VALUES ($1::uuid, 'pending_approval', $2::timestamptz, $3::timestamptz, $4::uuid)
        RETURNING id::text AS id
      `,
      [input.delegationId, input.startsAt, input.endsAt, input.actorUserId],
    );
    const changeId = inserted.rows[0]!.id;
    for (const guid of input.clientGuids) {
      await client.query(
        `
          INSERT INTO delegation_change_request_clients (change_request_id, guid_client)
          VALUES ($1::uuid, $2::uuid)
        `,
        [changeId, guid],
      );
    }

    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.DELEGATION_UPDATE,
      entityType: "delegation_change_request",
      entityId: changeId,
      after: input,
      basis: input.basis,
    });

    return { id: changeId };
  });
}

export async function approveDelegationChange(input: {
  actorUserId: string;
  actorRole: string;
  changeRequestId: string;
  basis: string;
  businessApproverUserId?: string | null;
}): Promise<void> {
  return withTransaction(async (client) => {
    const changePeek = await client.query<{ delegation_id: string; status: string }>(
      `
        SELECT delegation_id::text, status
        FROM delegation_change_requests
        WHERE id = $1::uuid
      `,
      [input.changeRequestId],
    );
    const peek = changePeek.rows[0];
    if (!peek || peek.status !== "pending_approval") {
      throw new AccessServiceError("Запрос изменения не найден.", "NOT_FOUND");
    }

    const delegation = await getDelegationForUpdate(client, peek.delegation_id);

    const changeResult = await client.query<{
      id: string;
      delegation_id: string;
      status: string;
      proposed_starts_at: Date;
      proposed_ends_at: Date;
    }>(
      `
        SELECT id::text, delegation_id::text, status, proposed_starts_at, proposed_ends_at
        FROM delegation_change_requests
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [input.changeRequestId],
    );
    const change = changeResult.rows[0];
    if (!change || change.status !== "pending_approval") {
      throw new AccessServiceError("Запрос изменения не найден.", "NOT_FOUND");
    }
    await maybeHoldConcurrencyAt("approve-change");
    let businessApproverId: string;

    if (input.actorRole === "admin") {
      if (!input.businessApproverUserId) {
        throw new AccessServiceError("Нужен businessApproverUserId.", "VALIDATION");
      }
      const approver = await getActiveUser(client, input.businessApproverUserId);
      const allowed = await canBusinessApproveDelegation(
        client,
        approver,
        delegation.delegator_user_id,
      );
      if (!allowed) {
        throw new AccessServiceError("Указанный согласующий не уполномочен.", "FORBIDDEN");
      }
      businessApproverId = approver.id;
    } else {
      const actor = await getActiveUser(client, input.actorUserId);
      const allowed = await canBusinessApproveDelegation(
        client,
        actor,
        delegation.delegator_user_id,
      );
      if (!allowed) {
        throw new AccessServiceError("Недостаточно прав для согласования изменения.", "FORBIDDEN");
      }
      businessApproverId = actor.id;
    }

    const clients = await client.query<{ guid_client: string; name_client: string }>(
      `
        SELECT oc.guid_client::text, oc.name_client
        FROM delegation_change_request_clients dcc
        JOIN onec_clients oc ON oc.guid_client = dcc.guid_client
        WHERE dcc.change_request_id = $1::uuid
      `,
      [input.changeRequestId],
    );
    const clientGuids = clients.rows.map((row) => row.guid_client);
    await assertDelegatorEffectiveClientAccess(client, delegation.delegator_user_id, clientGuids);
    await assertActorCanViewDelegationClientsForApproval({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      delegatorUserId: delegation.delegator_user_id,
      entries: clients.rows.map((row) => ({
        guid: row.guid_client,
        name: row.name_client,
      })),
    });

    await client.query(`DELETE FROM delegation_clients WHERE delegation_id = $1::uuid`, [
      delegation.id,
    ]);
    await insertDelegationClients(client, delegation.id, clientGuids);

    const delegationUpdated = await client.query(
      `
        UPDATE delegations
        SET
          starts_at = $2::timestamptz,
          ends_at = $3::timestamptz,
          approved_by_user_id = $4::uuid,
          business_approver_user_id = $4::uuid,
          approved_at = NOW(),
          updated_at = NOW(),
          row_version = row_version + 1
        WHERE id = $1::uuid AND status = 'active' AND revoked_at IS NULL
      `,
      [delegation.id, change.proposed_starts_at, change.proposed_ends_at, businessApproverId],
    );
    if (delegationUpdated.rowCount !== 1) {
      throw new AccessServiceError("Не удалось применить изменение.", "CONFLICT");
    }

    const changeUpdated = await client.query(
      `
        UPDATE delegation_change_requests
        SET status = 'approved', approved_by_user_id = $2::uuid, approved_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid AND status = 'pending_approval'
      `,
      [input.changeRequestId, businessApproverId],
    );
    if (changeUpdated.rowCount !== 1) {
      throw new AccessServiceError("Не удалось согласовать изменение.", "CONFLICT");
    }

    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      businessActorUserId: businessApproverId,
      action: "delegation.change.approve",
      entityType: "delegation_change_request",
      entityId: input.changeRequestId,
      after: { clientGuids, startsAt: change.proposed_starts_at, endsAt: change.proposed_ends_at },
      basis: input.basis,
    });
  });
}

export async function searchUsers(queryText: string, limit = 20) {
  const { query } = await import("../db/pool");
  const result = await query<{
    id: string;
    email: string;
    full_name: string;
    role: string;
    status: string;
    employee_id: string | null;
  }>(
    `
      SELECT
        u.id::text,
        u.email,
        u.full_name,
        u.role,
        u.status,
        l.employee_id::text
      FROM users u
      LEFT JOIN user_onec_employee_links l
        ON l.user_id = u.id AND l.revoked_at IS NULL
      WHERE u.email ILIKE $1 OR u.full_name ILIKE $1
      ORDER BY u.email ASC
      LIMIT $2
    `,
    [`%${queryText}%`, limit],
  );
  return result.rows;
}

export async function listScopedOverview(actorUserId: string, actorRole: string) {
  if (actorRole === "admin") {
    const { listAccessOverview } = await import("./admin-repository");
    return listAccessOverview();
  }

  if (actorRole === "rop") {
    const result = await withTransaction(async (client) =>
      client.query(
        `
          SELECT
            d.id::text,
            d.delegator_user_id::text,
            d.status,
            d.starts_at,
            d.ends_at,
            d.revoked_at,
            delegator.full_name AS delegator_name,
            delegator.email AS delegator_email,
            assistant.full_name AS assistant_name,
            assistant.email AS assistant_email,
            EXISTS (
              SELECT 1
              FROM delegation_change_requests dcr
              WHERE dcr.delegation_id = d.id AND dcr.status = 'pending_approval'
            ) AS pending_change
          FROM delegations d
          JOIN users delegator ON delegator.id = d.delegator_user_id
          JOIN users assistant ON assistant.id = d.assistant_user_id
          JOIN rop_team_members rtm
            ON rtm.member_user_id = d.delegator_user_id
           AND rtm.rop_user_id = $1::uuid
           AND rtm.revoked_at IS NULL
          ORDER BY d.created_at DESC
          LIMIT 100
        `,
        [actorUserId],
      ),
    );
    return { delegations: await enrichOverviewDelegations(actorUserId, actorRole, result.rows) };
  }

  if (actorRole === "manager") {
    const result = await withTransaction(async (client) =>
      client.query(
        `
          SELECT
            d.id::text,
            d.delegator_user_id::text,
            d.status,
            d.starts_at,
            d.ends_at,
            d.revoked_at,
            assistant.full_name AS assistant_name,
            assistant.email AS assistant_email,
            EXISTS (
              SELECT 1
              FROM delegation_change_requests dcr
              WHERE dcr.delegation_id = d.id AND dcr.status = 'pending_approval'
            ) AS pending_change
          FROM delegations d
          JOIN users assistant ON assistant.id = d.assistant_user_id
          WHERE d.delegator_user_id = $1::uuid
          ORDER BY d.created_at DESC
          LIMIT 100
        `,
        [actorUserId],
      ),
    );
    return { delegations: await enrichOverviewDelegations(actorUserId, actorRole, result.rows) };
  }

  if (actorRole === "director") {
    const result = await withTransaction(async (client) =>
      client.query(
        `
          SELECT
            d.id::text,
            d.delegator_user_id::text,
            d.status,
            d.starts_at,
            d.ends_at,
            d.revoked_at,
            delegator.full_name AS delegator_name,
            delegator.email AS delegator_email,
            assistant.full_name AS assistant_name,
            assistant.email AS assistant_email,
            EXISTS (
              SELECT 1
              FROM delegation_change_requests dcr
              WHERE dcr.delegation_id = d.id AND dcr.status = 'pending_approval'
            ) AS pending_change
          FROM delegations d
          JOIN users delegator ON delegator.id = d.delegator_user_id
          JOIN users assistant ON assistant.id = d.assistant_user_id
          ORDER BY d.created_at DESC
          LIMIT 100
        `,
      ),
    );
    return { delegations: await enrichOverviewDelegations(actorUserId, actorRole, result.rows) };
  }

  if (actorRole === "coordinator") {
    const teams = await withTransaction(async (client) =>
      client.query(
        `
          SELECT
            cta.id::text,
            rop.full_name AS rop_name,
            rop.email AS rop_email,
            cta.basis
          FROM coordinator_team_assignments cta
          JOIN users rop ON rop.id = cta.rop_user_id
          WHERE cta.coordinator_user_id = $1::uuid
            AND cta.revoked_at IS NULL
          ORDER BY rop.full_name ASC
        `,
        [actorUserId],
      ),
    );
    const delegations = await withTransaction(async (client) =>
      client.query(
        `
          SELECT
            d.id::text,
            d.delegator_user_id::text,
            d.status,
            d.starts_at,
            d.ends_at,
            d.revoked_at,
            delegator.full_name AS delegator_name,
            assistant.full_name AS assistant_name,
            EXISTS (
              SELECT 1
              FROM delegation_change_requests dcr
              WHERE dcr.delegation_id = d.id AND dcr.status = 'pending_approval'
            ) AS pending_change
          FROM delegations d
          JOIN users delegator ON delegator.id = d.delegator_user_id
          JOIN users assistant ON assistant.id = d.assistant_user_id
          JOIN rop_team_members rtm
            ON rtm.member_user_id = d.delegator_user_id
           AND rtm.revoked_at IS NULL
          JOIN coordinator_team_assignments cta
            ON cta.rop_user_id = rtm.rop_user_id
           AND cta.coordinator_user_id = $1::uuid
           AND cta.revoked_at IS NULL
          ORDER BY d.created_at DESC
          LIMIT 100
        `,
        [actorUserId],
      ),
    );
    return {
      teams: teams.rows,
      delegations: await enrichOverviewDelegations(actorUserId, actorRole, delegations.rows),
    };
  }

  throw new AccessServiceError("Недостаточно прав для просмотра.", "FORBIDDEN");
}

export async function listRopTeamMembers(ropUserId: string) {
  return withTransaction(async (client) =>
    client.query(
      `
        SELECT
          rtm.id::text,
          member.full_name AS member_name,
          member.email AS member_email,
          member.role AS member_role,
          rtm.basis
        FROM rop_team_members rtm
        JOIN users member ON member.id = rtm.member_user_id
        WHERE rtm.rop_user_id = $1::uuid
          AND rtm.revoked_at IS NULL
        ORDER BY member.full_name ASC
      `,
      [ropUserId],
    ),
  );
}

export async function addCoordinatorTeamAssignment(input: {
  actorUserId: string;
  coordinatorUserId: string;
  ropUserId: string;
  basis: string;
}): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    const coordinator = await getActiveUser(client, input.coordinatorUserId);
    if (coordinator.role !== "coordinator") {
      throw new AccessServiceError("Пользователь не является координатором.", "VALIDATION");
    }
    const rop = await getActiveUser(client, input.ropUserId);
    if (rop.role !== "rop") {
      throw new AccessServiceError("Пользователь не является РОП.", "VALIDATION");
    }
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO coordinator_team_assignments (
          coordinator_user_id, rop_user_id, basis, created_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
        RETURNING id::text AS id
      `,
      [input.coordinatorUserId, input.ropUserId, input.basis, input.actorUserId],
    );
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.COORDINATOR_TEAM_ADD,
      entityType: "coordinator_team_assignment",
      entityId: inserted.rows[0]!.id,
      after: input,
      basis: input.basis,
    });
    return { id: inserted.rows[0]!.id };
  });
}

export async function revokeCoordinatorTeamAssignment(input: {
  actorUserId: string;
  assignmentId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  return withTransaction(async (client) => {
    const before = await client.query(
      "SELECT * FROM coordinator_team_assignments WHERE id = $1::uuid FOR UPDATE",
      [input.assignmentId],
    );
    const row = before.rows[0];
    if (!row || row.revoked_at) {
      throw new AccessServiceError("Назначение координатора не найдено.", "NOT_FOUND");
    }
    const updated = await client.query(
      `
        UPDATE coordinator_team_assignments
        SET revoked_at = NOW(), revoked_by_user_id = $2::uuid, revoke_reason = $3
        WHERE id = $1::uuid AND revoked_at IS NULL
      `,
      [input.assignmentId, input.actorUserId, input.reason],
    );
    if (updated.rowCount !== 1) {
      throw new AccessServiceError("Назначение координатора не найдено.", "NOT_FOUND");
    }
    await writeAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.COORDINATOR_TEAM_REVOKE,
      entityType: "coordinator_team_assignment",
      entityId: input.assignmentId,
      before: row,
      after: { revoked: true },
      basis: input.basis,
    });
  });
}

export async function searchAssistants(queryText: string, limit = 20) {
  const { query } = await import("../db/pool");
  const result = await query<{
    id: string;
    email: string;
    full_name: string;
    status: string;
  }>(
    `
      SELECT id::text, email, full_name, status
      FROM users
      WHERE role = 'assistant'
        AND status = 'active'
        AND (email ILIKE $1 OR full_name ILIKE $1)
      ORDER BY full_name ASC
      LIMIT $2
    `,
    [`%${queryText}%`, limit],
  );
  return result.rows;
}

export async function listClientsForDelegator(input: {
  actorUserId: string;
  actorRole: string;
  delegatorUserId: string;
  page: number;
  pageSize: number;
  q?: string;
}) {
  if (input.actorRole === "manager" && input.actorUserId !== input.delegatorUserId) {
    throw new AccessServiceError("Менеджер может выбирать только своих клиентов.", "NOT_FOUND");
  }
  if (input.actorRole === "coordinator") {
    const allowed = await withTransaction(async (client) =>
      coordinatorAssignedToDelegatorTeam(client, input.actorUserId, input.delegatorUserId),
    );
    if (!allowed) {
      throw new AccessServiceError("Нет доступа к клиентам передающего.", "NOT_FOUND");
    }
  }
  if (input.actorRole === "rop") {
    const allowed = await withTransaction(async (client) =>
      ropManagesDelegator(client, input.actorUserId, input.delegatorUserId),
    );
    if (!allowed && input.actorUserId !== input.delegatorUserId) {
      throw new AccessServiceError("Нет доступа к клиентам передающего.", "NOT_FOUND");
    }
  }

  const { loadAccessContext } = await import("./context");
  const { appendUserDenials, buildClientScopeSql } = await import("./scope-sql");
  const { intersectClientScopes } = await import("./combine-filters");
  const delegatorContext = await loadAccessContext(input.delegatorUserId);
  let effectiveScope = buildClientScopeSql(delegatorContext);
  if (input.actorUserId !== input.delegatorUserId) {
    const callerContext = await loadAccessContext(
      input.actorUserId,
      input.actorRole as import("../shared/user").UserRole,
    );
    if (callerContext.explicitlyDeniedAll) {
      effectiveScope = { whereSql: "WHERE FALSE", params: [] };
    } else if (input.actorRole === "coordinator") {
      effectiveScope = appendUserDenials(effectiveScope, input.actorUserId);
    } else {
      const callerScope = buildClientScopeSql(callerContext);
      effectiveScope = intersectClientScopes(effectiveScope, callerScope);
    }
  }
  return listDelegatorClientsPicker(effectiveScope, {
    view: "all",
    q: input.q ?? "",
    phone: "all",
    hasOutlets: "all",
    page: input.page,
    pageSize: input.pageSize,
  });
}

export async function listCoordinatorManagers(coordinatorUserId: string) {
  return withTransaction(async (client) =>
    client.query(
      `
        SELECT DISTINCT
          member.id::text,
          member.full_name,
          member.email,
          member.role
        FROM coordinator_team_assignments cta
        JOIN rop_team_members rtm
          ON rtm.rop_user_id = cta.rop_user_id
         AND rtm.revoked_at IS NULL
        JOIN users member ON member.id = rtm.member_user_id
        WHERE cta.coordinator_user_id = $1::uuid
          AND cta.revoked_at IS NULL
          AND member.status = 'active'
        ORDER BY member.full_name ASC
      `,
      [coordinatorUserId],
    ),
  );
}

export async function getDelegationDetail(input: {
  actorUserId: string;
  actorRole: string;
  delegationId: string;
}) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        SELECT
          d.id::text,
          d.delegator_user_id::text,
          d.assistant_user_id::text,
          d.status,
          d.starts_at,
          d.ends_at,
          d.revoked_at,
          d.approved_at,
          delegator.full_name AS delegator_name,
          delegator.email AS delegator_email,
          assistant.full_name AS assistant_name,
          assistant.email AS assistant_email,
          EXISTS (
            SELECT 1 FROM delegation_change_requests dcr
            WHERE dcr.delegation_id = d.id AND dcr.status = 'pending_approval'
          ) AS pending_change
        FROM delegations d
        JOIN users delegator ON delegator.id = d.delegator_user_id
        JOIN users assistant ON assistant.id = d.assistant_user_id
        WHERE d.id = $1::uuid
      `,
      [input.delegationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AccessServiceError("Замещение не найдено.", "NOT_FOUND");
    }
    await assertCanManageDelegation(client, input.actorUserId, input.actorRole, {
      delegator_user_id: row.delegator_user_id,
    });

    const clients = await client.query(
      `
        SELECT oc.guid_client::text AS guid, oc.name_client AS name
        FROM delegation_clients dc
        JOIN onec_clients oc ON oc.guid_client = dc.guid_client
        WHERE dc.delegation_id = $1::uuid
        ORDER BY oc.name_client ASC
      `,
      [input.delegationId],
    );

    const pendingChange = await client.query(
      `
        SELECT
          dcr.id::text,
          dcr.proposed_starts_at,
          dcr.proposed_ends_at,
          COALESCE(
            (
              SELECT json_agg(json_build_object('guid', oc.guid_client::text, 'name', oc.name_client) ORDER BY oc.name_client)
              FROM delegation_change_request_clients dcc
              JOIN onec_clients oc ON oc.guid_client = dcc.guid_client
              WHERE dcc.change_request_id = dcr.id
            ),
            '[]'::json
          ) AS proposed_clients
        FROM delegation_change_requests dcr
        WHERE dcr.delegation_id = $1::uuid AND dcr.status = 'pending_approval'
        LIMIT 1
      `,
      [input.delegationId],
    );

    const currentAccess = await resolveDelegationClientsAccess({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      delegatorUserId: row.delegator_user_id,
      entries: clients.rows.map((entry) => ({
        guid: entry.guid,
        name: entry.name,
      })),
    });

    let pendingChangePayload: Record<string, unknown> | null = null;
    const pendingRow = pendingChange.rows[0];
    if (pendingRow) {
      const proposedRaw = Array.isArray(pendingRow.proposed_clients)
        ? (pendingRow.proposed_clients as Array<{ guid: string; name: string }>)
        : [];
      const proposedAccess = await resolveDelegationClientsAccess({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        delegatorUserId: row.delegator_user_id,
        entries: proposedRaw.map((entry) => ({ guid: entry.guid, name: entry.name })),
      });
      pendingChangePayload = {
        id: pendingRow.id,
        proposed_starts_at: pendingRow.proposed_starts_at,
        proposed_ends_at: pendingRow.proposed_ends_at,
        proposed_clients: proposedAccess.access === "visible" ? proposedAccess.clients : null,
        clients_access: proposedAccess.access,
        clients_access_message:
          proposedAccess.access === "restricted" ? proposedAccess.message : null,
      };
    }

    const enriched = enrichDelegationRow(row);
    return {
      ...enriched,
      clients: currentAccess.access === "visible" ? currentAccess.clients : null,
      clients_access: currentAccess.access,
      clients_access_message:
        currentAccess.access === "restricted" ? currentAccess.message : null,
      pending_change_request: pendingChangePayload,
    };
  });
}
