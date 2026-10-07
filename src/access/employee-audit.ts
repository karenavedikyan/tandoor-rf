import { query } from "../db/pool";
import { ACCESS_AUDIT_ACTIONS } from "./constants";
import { USER_AUDIT_ENTITY_TYPE } from "./user-provisioning";

export type EmployeeAuditCoverageEntry = {
  domain: string;
  label: string;
  source: string;
  actorField: string;
  notes: string;
};

/** Documented coverage matrix; not a claim of completeness from CLI flags alone. */
export const EMPLOYEE_AUDIT_COVERAGE: EmployeeAuditCoverageEntry[] = [
  {
    domain: "rights",
    label: "Права и связи",
    source: "access_audit_log",
    actorField: "actor_user_id",
    notes: "grants, teams, employee links, delegations, denials",
  },
  {
    domain: "account",
    label: "Изменения учётной записи",
    source: "access_audit_log",
    actorField: "entity_id (user)",
    notes: "create, role assign, password set/change",
  },
  {
    domain: "onec_import",
    label: "Импорт / обновление 1С",
    source: "onec_import_jobs",
    actorField: "requested_by_user_id",
    notes: "regular_update / clients_snapshot jobs by requested_by_user_id",
  },
  {
    domain: "distribution",
    label: "Дистрибуция витрины",
    source: "outlet_distribution_marker_events",
    actorField: "actor_user_id",
    notes: "set/clear markers",
  },
  {
    domain: "preview",
    label: "Preview от имени сотрудника",
    source: "access_audit_log",
    actorField: "actor_user_id (admin)",
    notes: "preview.start/stop; target in entity_id, не подменяет автора действий сотрудника",
  },
  {
    domain: "exports",
    label: "Экспорт / выгрузки",
    source: "onec_client_import_runs + journals",
    actorField: "trigger_source / journals",
    notes: "частично через import runs без actor; см. job_source nightly/admin_manual",
  },
];

export type EmployeeAuditEvent = {
  id: string;
  source: string;
  domain: string;
  action: string;
  actorUserId: string;
  actorEmail: string;
  occurredAt: string;
  basis: string | null;
  summary: string;
};

export type EmployeeAuditQueryInput = {
  userId: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

function parseLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

function buildDateFilters(column: string, from?: Date, to?: Date, startIndex = 2): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;
  if (from) {
    clauses.push(`${column} >= $${index++}`);
    params.push(from.toISOString());
  }
  if (to) {
    clauses.push(`${column} <= $${index++}`);
    params.push(to.toISOString());
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", params };
}

/** Changes applied to the employee account (subject = user). */
export async function queryEmployeeAccountChanges(
  input: EmployeeAuditQueryInput,
): Promise<EmployeeAuditEvent[]> {
  const limit = parseLimit(input.limit);
  const params: unknown[] = [USER_AUDIT_ENTITY_TYPE, input.userId];
  const dates = buildDateFilters("a.created_at", input.from, input.to, params.length + 1);
  params.push(...dates.params);
  params.push(limit);
  const limitIndex = params.length;
  const result = await query<{
    id: string;
    action: string;
    actor_user_id: string;
    actor_email: string;
    basis: string | null;
    created_at: Date;
  }>(
    `
      SELECT
        a.id::text,
        a.action,
        a.actor_user_id::text,
        actor.email AS actor_email,
        a.basis,
        a.created_at
      FROM access_audit_log a
      JOIN users actor ON actor.id = a.actor_user_id
      WHERE a.entity_type = $1
        AND a.entity_id = $2::uuid
        ${dates.sql}
      ORDER BY a.created_at DESC
      LIMIT $${limitIndex}
    `,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: "access_audit_log",
    domain: "account",
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    occurredAt: row.created_at.toISOString(),
    basis: row.basis,
    summary: row.action,
  }));
}

/** Actions performed by the employee as real actor (not preview target). */
export async function queryEmployeeActionsPerformed(
  input: EmployeeAuditQueryInput,
): Promise<EmployeeAuditEvent[]> {
  const limit = parseLimit(input.limit);
  const accessParams: unknown[] = [input.userId];
  const accessDates = buildDateFilters("a.created_at", input.from, input.to, accessParams.length + 1);
  accessParams.push(...accessDates.params);
  accessParams.push(limit);
  const accessLimitIndex = accessParams.length;
  const accessRows = await query<{
    id: string;
    action: string;
    entity_type: string;
    actor_user_id: string;
    actor_email: string;
    basis: string | null;
    created_at: Date;
  }>(
    `
      SELECT
        a.id::text,
        a.action,
        a.entity_type,
        a.actor_user_id::text,
        actor.email AS actor_email,
        a.basis,
        a.created_at
      FROM access_audit_log a
      JOIN users actor ON actor.id = a.actor_user_id
      WHERE a.actor_user_id = $1::uuid
        AND NOT (a.entity_type = 'user' AND a.entity_id = $1::uuid)
        ${accessDates.sql}
      ORDER BY a.created_at DESC
      LIMIT $${accessLimitIndex}
    `,
    accessParams,
  );

  const importParams: unknown[] = [input.userId];
  const importDates = buildDateFilters("j.requested_at", input.from, input.to, importParams.length + 1);
  importParams.push(...importDates.params);
  importParams.push(limit);
  const importLimitIndex = importParams.length;
  const importRows = await query<{
    id: string;
    kind: string;
    status: string;
    requested_at: Date;
    actor_email: string;
  }>(
    `
      SELECT
        j.id::text,
        j.kind,
        j.status,
        j.requested_at,
        u.email AS actor_email
      FROM onec_import_jobs j
      JOIN users u ON u.id = j.requested_by_user_id
      WHERE j.requested_by_user_id = $1::uuid
        ${importDates.sql}
      ORDER BY j.requested_at DESC
      LIMIT $${importLimitIndex}
    `,
    importParams,
  );

  const distributionParams: unknown[] = [input.userId];
  const distributionDates = buildDateFilters(
    "e.occurred_at",
    input.from,
    input.to,
    distributionParams.length + 1,
  );
  distributionParams.push(...distributionDates.params);
  distributionParams.push(limit);
  const distributionLimitIndex = distributionParams.length;
  const distributionRows = await query<{
    id: string;
    event_kind: string;
    product_code: string;
    occurred_at: Date;
    actor_email: string;
    actor_user_id: string;
  }>(
    `
      SELECT
        e.id::text,
        e.event_kind,
        e.product_code,
        e.occurred_at,
        u.email AS actor_email,
        e.actor_user_id::text
      FROM outlet_distribution_marker_events e
      JOIN users u ON u.id = e.actor_user_id
      WHERE e.actor_user_id = $1::uuid
        ${distributionDates.sql}
      ORDER BY e.occurred_at DESC
      LIMIT $${distributionLimitIndex}
    `,
    distributionParams,
  );

  const events: EmployeeAuditEvent[] = [
    ...accessRows.rows.map((row) => ({
      id: `access:${row.id}`,
      source: "access_audit_log",
      domain: row.entity_type === "user_preview" ? "preview" : "rights",
      action: row.action,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      occurredAt: row.created_at.toISOString(),
      basis: row.basis,
      summary: row.action,
    })),
    ...importRows.rows.map((row) => ({
      id: `onec_job:${row.id}`,
      source: "onec_import_jobs",
      domain: "onec_import",
      action: `onec_import.${row.kind}.${row.status}`,
      actorUserId: input.userId,
      actorEmail: row.actor_email,
      occurredAt: row.requested_at.toISOString(),
      basis: null,
      summary: `${row.kind} → ${row.status}`,
    })),
    ...distributionRows.rows.map((row) => ({
      id: `distribution:${row.id}`,
      source: "outlet_distribution_marker_events",
      domain: "distribution",
      action: `distribution.${row.event_kind}`,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      occurredAt: row.occurred_at.toISOString(),
      basis: null,
      summary: `${row.event_kind} ${row.product_code}`,
    })),
  ];

  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return events.slice(0, limit);
}

export async function queryEmployeeAuditReport(input: EmployeeAuditQueryInput): Promise<{
  coverage: EmployeeAuditCoverageEntry[];
  accountChanges: EmployeeAuditEvent[];
  actionsPerformed: EmployeeAuditEvent[];
  disclaimer: string;
}> {
  const [accountChanges, actionsPerformed] = await Promise.all([
    queryEmployeeAccountChanges(input),
    queryEmployeeActionsPerformed(input),
  ]);
  return {
    coverage: EMPLOYEE_AUDIT_COVERAGE,
    accountChanges,
    actionsPerformed,
    disclaimer:
      "Просмотр персонального аудита перед выдачей прав не заменяет полный журнал действий. Preview фиксирует admin как actor_user_id.",
  };
}
