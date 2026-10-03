import type { TransactionClient } from "../../access/db";
import { withTransaction } from "../../access/db";
import { combineScopeAndFilter } from "../../access/combine-filters";
import { buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
} from "../../onec-clients/baseline-active-scope";
import type { ReviewDecision, ReviewState } from "./constants";
import { REVIEW_DECISIONS, REVIEW_STATES } from "./constants";

export type ClientReviewRecord = {
  guidClient: string;
  reviewState: ReviewState;
  reviewDecision: ReviewDecision | null;
  comment: string | null;
  proposedManagerGuid: string | null;
  assignedReviewerUserId: string | null;
  dueAt: string | null;
  version: number;
  basisManagerGuid: string;
  basisSourceSha256: string | null;
  basisImportedAt: string | null;
  staleReason: string | null;
  isStale: boolean;
  transferStatus: "none" | "proposed" | "confirmed_in_1c";
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientReviewHistoryEntry = {
  id: string;
  version: number;
  changedByUserId: string;
  changeType: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export class ReviewServiceError extends Error {
  code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "VALIDATION";

  constructor(message: string, code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "VALIDATION") {
    super(message);
    this.code = code;
  }
}

type ReviewRow = {
  guid_client: string;
  review_state: ReviewState;
  review_decision: ReviewDecision | null;
  comment: string | null;
  proposed_manager_guid: string | null;
  assigned_reviewer_user_id: string | null;
  due_at: Date | null;
  version: number;
  basis_manager_guid: string;
  basis_source_sha256: string | null;
  basis_imported_at: Date | null;
  stale_reason: string | null;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  current_manager_guid: string;
  current_source_sha256: string | null;
  current_imported_at: Date;
};

function computeTransferStatus(
  row: Pick<
    ReviewRow,
    | "review_decision"
    | "proposed_manager_guid"
    | "basis_manager_guid"
    | "current_manager_guid"
    | "stale_reason"
  >,
): ClientReviewRecord["transferStatus"] {
  if (row.review_decision !== "propose_transfer" || !row.proposed_manager_guid) {
    return "none";
  }
  if (
    row.current_manager_guid.toLowerCase() === row.proposed_manager_guid.toLowerCase() &&
    !row.stale_reason
  ) {
    return "confirmed_in_1c";
  }
  return "proposed";
}

function toReviewRecord(row: ReviewRow): ClientReviewRecord {
  const managerChanged =
    row.current_manager_guid.toLowerCase() !== row.basis_manager_guid.toLowerCase();
  const sourceChanged =
    row.basis_source_sha256 != null &&
    row.current_source_sha256 != null &&
    row.basis_source_sha256 !== row.current_source_sha256;
  const isStale = Boolean(row.stale_reason) || managerChanged || sourceChanged;

  return {
    guidClient: row.guid_client,
    reviewState: isStale && row.review_state === "completed" ? "needs_recheck" : row.review_state,
    reviewDecision: row.review_decision,
    comment: row.comment,
    proposedManagerGuid: row.proposed_manager_guid,
    assignedReviewerUserId: row.assigned_reviewer_user_id,
    dueAt: row.due_at?.toISOString() ?? null,
    version: row.version,
    basisManagerGuid: row.basis_manager_guid,
    basisSourceSha256: row.basis_source_sha256,
    basisImportedAt: row.basis_imported_at?.toISOString() ?? null,
    staleReason:
      row.stale_reason ??
      (managerChanged
        ? "Импорт изменил назначение ответственного; требуется повторная проверка."
        : sourceChanged
          ? "Импорт изменил данные клиента; требуется повторная проверка."
          : null),
    isStale,
    transferStatus: computeTransferStatus(row),
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const REVIEW_SELECT = `
  SELECT
    crr.guid_client::text,
    crr.review_state,
    crr.review_decision,
    crr.comment,
    crr.proposed_manager_guid::text,
    crr.assigned_reviewer_user_id::text,
    crr.due_at,
    crr.version,
    crr.basis_manager_guid::text,
    crr.basis_source_sha256,
    crr.basis_imported_at,
    crr.stale_reason,
    crr.created_by_user_id::text,
    crr.updated_by_user_id::text,
    crr.created_at,
    crr.updated_at,
    oc.guid_manager::text AS current_manager_guid,
    oc.source_sha256 AS current_source_sha256,
    oc.last_imported_at AS current_imported_at
  FROM client_review_records crr
  JOIN onec_clients oc ON oc.guid_client = crr.guid_client
  WHERE ${ACTIVE_BASELINE_OC_SQL.replaceAll("onec_clients.", "oc.")}
`;

async function assertClientInScope(context: AccessContext, guidClient: string): Promise<void> {
  const scope = buildClientScopeSql(context);
  const filter = combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_client = $1::uuid",
    params: [guidClient.toLowerCase()],
  });
  if (filter.whereSql === "WHERE FALSE") {
    throw new ReviewServiceError("Нет доступа к клиенту.", "FORBIDDEN");
  }
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients ${filter.whereSql}`,
    filter.params,
  );
  if (Number(result.rows[0]?.count ?? "0") === 0) {
    throw new ReviewServiceError("Клиент не найден.", "NOT_FOUND");
  }
}

async function assertProposedManagerEligible(proposedManagerGuid: string): Promise<void> {
  const link = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM user_onec_employee_links uoel
      JOIN users u ON u.id = uoel.user_id
      WHERE uoel.employee_id = $1::uuid
        AND uoel.revoked_at IS NULL
        AND u.status = 'active'
        AND u.role IN ('manager', 'rop')
    `,
    [proposedManagerGuid.toLowerCase()],
  );
  if (Number(link.rows[0]?.count ?? "0") === 0) {
    throw new ReviewServiceError(
      "Предложенный менеджер должен быть подтверждённым действующим сотрудником ОПТ.",
      "VALIDATION",
    );
  }
  const rosterCheck = await query<{ roster_state: string }>(
    `
      SELECT COALESCE(MAX(manager_roster_state), 'in_wholesale_roster') AS roster_state
      FROM onec_clients
      WHERE guid_manager = $1::uuid
        AND ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
    `,
    [proposedManagerGuid.toLowerCase()],
  );
  const state = rosterCheck.rows[0]?.roster_state ?? "in_wholesale_roster";
  if (state === "outside_wholesale_roster") {
    throw new ReviewServiceError(
      "Предложенный менеджер находится вне списка ОПТ.",
      "VALIDATION",
    );
  }
}

export async function getClientReview(
  context: AccessContext,
  guidClient: string,
): Promise<ClientReviewRecord | null> {
  await assertClientInScope(context, guidClient);
  const result = await query<ReviewRow>(`${REVIEW_SELECT} AND crr.guid_client = $1::uuid`, [
    guidClient.toLowerCase(),
  ]);
  const row = result.rows[0];
  return row ? toReviewRecord(row) : null;
}

export async function listClientReviewHistory(
  context: AccessContext,
  guidClient: string,
): Promise<ClientReviewHistoryEntry[]> {
  await assertClientInScope(context, guidClient);
  const result = await query<{
    id: string;
    version: number;
    changed_by_user_id: string;
    change_type: string;
    before_json: unknown;
    after_json: unknown;
    created_at: Date;
  }>(
    `
      SELECT
        id::text,
        version,
        changed_by_user_id::text,
        change_type,
        before_json,
        after_json,
        created_at
      FROM client_review_history
      WHERE guid_client = $1::uuid
      ORDER BY created_at DESC, version DESC
      LIMIT 100
    `,
    [guidClient.toLowerCase()],
  );
  return result.rows.map((row) => ({
    id: row.id,
    version: row.version,
    changedByUserId: row.changed_by_user_id,
    changeType: row.change_type,
    before: row.before_json,
    after: row.after_json,
    createdAt: row.created_at.toISOString(),
  }));
}

export type UpsertClientReviewInput = {
  actorUserId: string;
  guidClient: string;
  expectedVersion?: number | null;
  reviewState: ReviewState;
  reviewDecision?: ReviewDecision | null;
  comment?: string | null;
  proposedManagerGuid?: string | null;
  assignedReviewerUserId?: string | null;
  dueAt?: string | null;
};

function validateReviewInput(input: UpsertClientReviewInput): void {
  if (!REVIEW_STATES.includes(input.reviewState)) {
    throw new ReviewServiceError("Некорректное состояние проверки.", "VALIDATION");
  }
  if (input.reviewDecision != null && !REVIEW_DECISIONS.includes(input.reviewDecision)) {
    throw new ReviewServiceError("Некорректное решение ревизии.", "VALIDATION");
  }
  if (input.reviewDecision === "propose_transfer") {
    if (!input.proposedManagerGuid) {
      throw new ReviewServiceError("Для передачи укажите менеджера.", "VALIDATION");
    }
  } else if (input.proposedManagerGuid) {
    throw new ReviewServiceError(
      "GUID менеджера допустим только для решения «предложить передачу».",
      "VALIDATION",
    );
  }
}

export async function upsertClientReview(
  context: AccessContext,
  input: UpsertClientReviewInput,
): Promise<ClientReviewRecord> {
  if (context.role !== "admin") {
    throw new ReviewServiceError("Изменять ревизию может только администратор.", "FORBIDDEN");
  }

  validateReviewInput(input);
  await assertClientInScope(context, input.guidClient);

  if (input.proposedManagerGuid) {
    await assertProposedManagerEligible(input.proposedManagerGuid);
  }

  return withTransaction(async (client: TransactionClient) => {
    const currentClient = await client.query<{
      guid_manager: string;
      source_sha256: string | null;
      last_imported_at: Date;
    }>(
      `
        SELECT guid_manager::text, source_sha256, last_imported_at
        FROM onec_clients
        WHERE guid_client = $1::uuid
          AND ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
        FOR UPDATE
      `,
      [input.guidClient.toLowerCase()],
    );
    const clientRow = currentClient.rows[0];
    if (!clientRow) {
      throw new ReviewServiceError("Клиент не найден.", "NOT_FOUND");
    }

    const existing = await client.query<ReviewRow>(
      `${REVIEW_SELECT} AND crr.guid_client = $1::uuid FOR UPDATE OF crr`,
      [input.guidClient.toLowerCase()],
    );
    const before = existing.rows[0] ? toReviewRecord(existing.rows[0]) : null;

    if (before && input.expectedVersion != null && before.version !== input.expectedVersion) {
      throw new ReviewServiceError(
        "Запись ревизии была изменена другим пользователем. Обновите страницу.",
        "CONFLICT",
      );
    }

    const nextVersion = (before?.version ?? 0) + 1;
    const basisManagerGuid = before?.basisManagerGuid ?? clientRow.guid_manager;
    const basisSourceSha256 = before?.basisSourceSha256 ?? clientRow.source_sha256;
    const basisImportedAt = before?.basisImportedAt
      ? new Date(before.basisImportedAt)
      : clientRow.last_imported_at;

    let staleReason: string | null = null;
    if (
      before &&
      (clientRow.guid_manager.toLowerCase() !== before.basisManagerGuid.toLowerCase() ||
        (before.basisSourceSha256 &&
          clientRow.source_sha256 &&
          before.basisSourceSha256 !== clientRow.source_sha256))
    ) {
      staleReason = "Импорт изменил назначение или состав клиента.";
    }

    const upserted = await client.query<ReviewRow>(
      `
        INSERT INTO client_review_records (
          guid_client,
          review_state,
          review_decision,
          comment,
          proposed_manager_guid,
          assigned_reviewer_user_id,
          due_at,
          version,
          basis_manager_guid,
          basis_source_sha256,
          basis_imported_at,
          stale_reason,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::uuid,
          $6::uuid,
          $7::timestamptz,
          $8,
          $9::uuid,
          $10,
          $11::timestamptz,
          $12,
          $13::uuid,
          $13::uuid
        )
        ON CONFLICT (guid_client) DO UPDATE SET
          review_state = EXCLUDED.review_state,
          review_decision = EXCLUDED.review_decision,
          comment = EXCLUDED.comment,
          proposed_manager_guid = EXCLUDED.proposed_manager_guid,
          assigned_reviewer_user_id = EXCLUDED.assigned_reviewer_user_id,
          due_at = EXCLUDED.due_at,
          version = EXCLUDED.version,
          stale_reason = EXCLUDED.stale_reason,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = NOW()
        RETURNING
          guid_client::text,
          review_state,
          review_decision,
          comment,
          proposed_manager_guid::text,
          assigned_reviewer_user_id::text,
          due_at,
          version,
          basis_manager_guid::text,
          basis_source_sha256,
          basis_imported_at,
          stale_reason,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at,
          updated_at
      `,
      [
        input.guidClient.toLowerCase(),
        staleReason && input.reviewState === "completed" ? "needs_recheck" : input.reviewState,
        input.reviewDecision ?? null,
        input.comment ?? null,
        input.proposedManagerGuid?.toLowerCase() ?? null,
        input.assignedReviewerUserId ?? null,
        input.dueAt ?? null,
        nextVersion,
        basisManagerGuid,
        basisSourceSha256,
        basisImportedAt,
        staleReason,
        input.actorUserId,
      ],
    );

    const saved = upserted.rows[0]!;
    const afterRow: ReviewRow = {
      ...saved,
      current_manager_guid: clientRow.guid_manager,
      current_source_sha256: clientRow.source_sha256,
      current_imported_at: clientRow.last_imported_at,
    };
    const after = toReviewRecord(afterRow);

    await client.query(
      `
        INSERT INTO client_review_history (
          guid_client,
          version,
          changed_by_user_id,
          change_type,
          before_json,
          after_json
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb)
      `,
      [
        input.guidClient.toLowerCase(),
        nextVersion,
        input.actorUserId,
        before ? "update" : "create",
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
      ],
    );

    return after;
  });
}

export function buildReviewStateFilter(
  reviewState: ReviewState | "any",
  reviewDecision?: ReviewDecision | "any",
): { joinSql: string; whereClauses: string[]; params: unknown[] } {
  const params: unknown[] = [];
  const whereClauses: string[] = [];
  const joinSql = `
    LEFT JOIN client_review_records crr ON crr.guid_client = onec_clients.guid_client
  `;

  if (reviewState === "unreviewed") {
    whereClauses.push("(crr.guid_client IS NULL OR crr.review_state = 'unreviewed')");
  } else if (reviewState !== "any") {
    params.push(reviewState);
    whereClauses.push(`crr.review_state = $${params.length}`);
  }

  if (reviewDecision && reviewDecision !== "any") {
    params.push(reviewDecision);
    whereClauses.push(`crr.review_decision = $${params.length}`);
  }

  return { joinSql, whereClauses, params };
}
