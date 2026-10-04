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
import { shortUuidLabel } from "../uuid-param";
import {
  CLIENT_REVIEW_FINGERPRINT_SQL,
  computeClientReviewFingerprint,
} from "./fingerprint";

export const REVIEW_COMMENT_MAX_LENGTH = 2000;

export type ClientReviewRecord = {
  guidClient: string;
  /** Effective queue/UI state; becomes needs_recheck while stale. */
  reviewState: ReviewState;
  /** Persisted workflow state in client_review_records.review_state. */
  storedReviewState: ReviewState;
  reviewDecision: ReviewDecision | null;
  comment: string | null;
  proposedManagerGuid: string | null;
  assignedReviewerUserId: string | null;
  dueAt: string | null;
  version: number;
  basisManagerGuid: string;
  basisSourceSha256: string | null;
  basisDataFingerprint: string | null;
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

export type EligibleReviewManager = {
  employeeGuid: string;
  name: string;
  shortId: string;
};

export type EligibleReviewer = {
  userId: string;
  name: string;
  shortId: string;
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
  basis_data_fingerprint: string | null;
  basis_imported_at: Date | null;
  stale_reason: string | null;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  current_manager_guid: string;
  current_source_sha256: string | null;
  current_imported_at: Date;
  current_name_client: string;
  current_guid_holding: string | null;
  current_guid_holding_pending: string | null;
  current_address: string;
  current_name_manager: string;
  current_data_fingerprint: string;
};

function fingerprintFromClientRow(row: {
  guid_manager: string;
  name_client: string;
  guid_holding: string | null;
  guid_holding_pending?: string | null;
  address: string;
  name_manager: string;
}): string {
  return computeClientReviewFingerprint({
    guidManager: row.guid_manager,
    nameClient: row.name_client,
    guidHolding: row.guid_holding,
    guidHoldingPending: row.guid_holding_pending ?? null,
    address: row.address,
    nameManager: row.name_manager,
  });
}

function reviewFingerprintSql(tableAlias: string): string {
  return CLIENT_REVIEW_FINGERPRINT_SQL.replaceAll("oc.", `${tableAlias}.`);
}

export function reviewConfirmedTransferSql(clientsAlias = "onec_clients"): string {
  return `(
    crr.review_decision = 'propose_transfer'
    AND crr.proposed_manager_guid IS NOT NULL
    AND lower(${clientsAlias}.guid_manager::text) = lower(crr.proposed_manager_guid::text)
    AND lower(crr.basis_manager_guid::text) <> lower(${clientsAlias}.guid_manager::text)
  )`;
}

export function reviewIsStaleSql(clientsAlias = "onec_clients"): string {
  const fingerprintSql = reviewFingerprintSql(clientsAlias);
  const confirmedTransferSql = reviewConfirmedTransferSql(clientsAlias);
  return `(
    crr.stale_reason IS NOT NULL
    OR (
      ${clientsAlias}.guid_manager IS DISTINCT FROM crr.basis_manager_guid
      AND NOT (${confirmedTransferSql})
    )
    OR (
      crr.basis_data_fingerprint IS NOT NULL
      AND ${fingerprintSql} <> crr.basis_data_fingerprint
    )
  )`;
}

export function reviewEffectiveStateSql(clientsAlias = "onec_clients"): string {
  const staleSql = reviewIsStaleSql(clientsAlias);
  return `
    CASE
      WHEN crr.guid_client IS NULL THEN 'unreviewed'
      WHEN ${staleSql} THEN 'needs_recheck'
      ELSE crr.review_state
    END
  `;
}

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
  const proposedMatchesCurrent =
    row.current_manager_guid.toLowerCase() === row.proposed_manager_guid.toLowerCase();
  const basisDiffersFromCurrent =
    row.basis_manager_guid.toLowerCase() !== row.current_manager_guid.toLowerCase();
  if (proposedMatchesCurrent && basisDiffersFromCurrent && !row.stale_reason) {
    return "confirmed_in_1c";
  }
  return "proposed";
}

function isConfirmedTransferRow(
  row: Pick<
    ReviewRow,
    "review_decision" | "proposed_manager_guid" | "basis_manager_guid" | "current_manager_guid"
  >,
): boolean {
  if (row.review_decision !== "propose_transfer" || !row.proposed_manager_guid) {
    return false;
  }
  return (
    row.current_manager_guid.toLowerCase() === row.proposed_manager_guid.toLowerCase() &&
    row.basis_manager_guid.toLowerCase() !== row.current_manager_guid.toLowerCase()
  );
}

function staleReasonForRow(row: ReviewRow): string | null {
  if (row.stale_reason) {
    return row.stale_reason;
  }
  const fingerprintChanged =
    row.basis_data_fingerprint != null &&
    row.current_data_fingerprint !== row.basis_data_fingerprint;
  const managerChanged =
    row.current_manager_guid.toLowerCase() !== row.basis_manager_guid.toLowerCase();
  if (managerChanged && !isConfirmedTransferRow(row)) {
    return "Импорт изменил назначение ответственного; требуется повторная проверка.";
  }
  if (fingerprintChanged) {
    return "Импорт изменил данные клиента; требуется повторная проверка.";
  }
  return null;
}

function toReviewRecord(row: ReviewRow): ClientReviewRecord {
  const staleReason = staleReasonForRow(row);
  const isStale = staleReason != null;

  return {
    guidClient: row.guid_client,
    reviewState: isStale ? "needs_recheck" : row.review_state,
    storedReviewState: row.review_state,
    reviewDecision: row.review_decision,
    comment: row.comment,
    proposedManagerGuid: row.proposed_manager_guid,
    assignedReviewerUserId: row.assigned_reviewer_user_id,
    dueAt: row.due_at?.toISOString() ?? null,
    version: row.version,
    basisManagerGuid: row.basis_manager_guid,
    basisSourceSha256: row.basis_source_sha256,
    basisDataFingerprint: row.basis_data_fingerprint,
    basisImportedAt: row.basis_imported_at?.toISOString() ?? null,
    staleReason,
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
    crr.basis_data_fingerprint,
    crr.basis_imported_at,
    crr.stale_reason,
    crr.created_by_user_id::text,
    crr.updated_by_user_id::text,
    crr.created_at,
    crr.updated_at,
    oc.guid_manager::text AS current_manager_guid,
    oc.source_sha256 AS current_source_sha256,
    oc.last_imported_at AS current_imported_at,
    oc.name_client AS current_name_client,
    oc.guid_holding::text AS current_guid_holding,
    oc.guid_holding_pending::text AS current_guid_holding_pending,
    oc.address AS current_address,
    oc.name_manager AS current_name_manager,
    ${reviewFingerprintSql("oc")} AS current_data_fingerprint
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

  const rosterCheck = await query<{ in_roster_count: string; roster_state: string | null }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE manager_roster_state = 'in_wholesale_roster')::text AS in_roster_count,
        MAX(manager_roster_state) AS roster_state
      FROM onec_clients
      WHERE guid_manager = $1::uuid
        AND ${ACTIVE_BASELINE_CLIENT_SQL.trim()}
    `,
    [proposedManagerGuid.toLowerCase()],
  );
  const inRosterCount = Number(rosterCheck.rows[0]?.in_roster_count ?? "0");
  if (inRosterCount === 0) {
    const rosterState = rosterCheck.rows[0]?.roster_state;
    if (rosterState === "roster_not_loaded") {
      throw new ReviewServiceError(
        "Справочник ОПТ не загружен; назначение на этого менеджера недоступно без подтверждённого roster.",
        "VALIDATION",
      );
    }
    throw new ReviewServiceError(
      "Предложенный менеджер находится вне списка ОПТ или не подтверждён в импорте.",
      "VALIDATION",
    );
  }
}

async function assertReviewerEligible(reviewerUserId: string): Promise<void> {
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM users
      WHERE id = $1::uuid
        AND status = 'active'
        AND role = 'admin'
    `,
    [reviewerUserId.toLowerCase()],
  );
  if (Number(result.rows[0]?.count ?? "0") === 0) {
    throw new ReviewServiceError(
      "Проверяющий должен быть действующим администратором с правом ревизии.",
      "VALIDATION",
    );
  }
}

export async function listEligibleReviewers(): Promise<EligibleReviewer[]> {
  const result = await query<{ user_id: string; full_name: string }>(
    `
      SELECT id::text AS user_id, full_name
      FROM users
      WHERE status = 'active'
        AND role = 'admin'
      ORDER BY full_name ASC, id ASC
    `,
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.full_name,
    shortId: shortUuidLabel(row.user_id),
  }));
}

export async function listEligibleReviewManagers(): Promise<EligibleReviewManager[]> {
  const result = await query<{ employee_guid: string; name: string }>(
    `
      SELECT DISTINCT ON (oc.guid_manager)
        oc.guid_manager::text AS employee_guid,
        oc.name_manager AS name
      FROM onec_clients oc
      JOIN user_onec_employee_links uoel
        ON uoel.employee_id = oc.guid_manager AND uoel.revoked_at IS NULL
      JOIN users u ON u.id = uoel.user_id
      WHERE ${ACTIVE_BASELINE_OC_SQL.trim()}
        AND oc.manager_roster_state = 'in_wholesale_roster'
        AND u.status = 'active'
        AND u.role IN ('manager', 'rop')
      ORDER BY oc.guid_manager ASC, oc.last_imported_at DESC
    `,
  );
  return result.rows.map((row) => ({
    employeeGuid: row.employee_guid,
    name: row.name,
    shortId: shortUuidLabel(row.employee_guid),
  }));
}

export async function getClientReview(
  context: AccessContext,
  guidClient: string,
): Promise<ClientReviewRecord | null> {
  if (context.role !== "admin") {
    throw new ReviewServiceError("Ревизия доступна только администратору.", "FORBIDDEN");
  }
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
  recheckConfirmed?: boolean;
};

function parseDueAt(value: string | null | undefined): Date | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReviewServiceError("Некорректная дата срока проверки.", "VALIDATION");
  }
  return parsed;
}

function validateReviewInput(input: UpsertClientReviewInput): void {
  if (!REVIEW_STATES.includes(input.reviewState)) {
    throw new ReviewServiceError("Некорректное состояние проверки.", "VALIDATION");
  }
  if (input.reviewDecision != null && !REVIEW_DECISIONS.includes(input.reviewDecision)) {
    throw new ReviewServiceError("Некорректное решение ревизии.", "VALIDATION");
  }
  if (input.comment != null && input.comment.length > REVIEW_COMMENT_MAX_LENGTH) {
    throw new ReviewServiceError(
      `Комментарий не может быть длиннее ${REVIEW_COMMENT_MAX_LENGTH} символов.`,
      "VALIDATION",
    );
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
  parseDueAt(input.dueAt ?? null);
}

function isMaintainingConfirmedTransfer(
  beforeRow: ReviewRow | null,
  clientManagerGuid: string,
  proposedManagerGuid: string | null | undefined,
): boolean {
  if (!beforeRow || beforeRow.review_decision !== "propose_transfer") {
    return false;
  }
  if (!beforeRow.proposed_manager_guid || !proposedManagerGuid) {
    return false;
  }
  const proposed = proposedManagerGuid.toLowerCase();
  const storedProposed = beforeRow.proposed_manager_guid.toLowerCase();
  const basis = beforeRow.basis_manager_guid.toLowerCase();
  const current = clientManagerGuid.toLowerCase();
  return proposed === storedProposed && proposed === current && basis !== current;
}

function assertOptimisticVersion(
  before: ClientReviewRecord | null,
  expectedVersion: number | null | undefined,
): void {
  if (before) {
    if (expectedVersion == null || !Number.isInteger(expectedVersion) || before.version !== expectedVersion) {
      throw new ReviewServiceError(
        "Запись ревизии была изменена другим пользователем. Обновите страницу.",
        "CONFLICT",
      );
    }
    return;
  }
  if (expectedVersion != null && expectedVersion !== 0) {
    throw new ReviewServiceError(
      "Запись ревизии была изменена другим пользователем. Обновите страницу.",
      "CONFLICT",
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
  if (input.assignedReviewerUserId) {
    await assertReviewerEligible(input.assignedReviewerUserId);
  }

  const dueAt = parseDueAt(input.dueAt ?? null);

  return withTransaction(async (client: TransactionClient) => {
    const currentClient = await client.query<{
      guid_manager: string;
      source_sha256: string | null;
      last_imported_at: Date;
      name_client: string;
      guid_holding: string | null;
      guid_holding_pending: string | null;
      address: string;
      name_manager: string;
    }>(
      `
        SELECT
          guid_manager::text,
          source_sha256,
          last_imported_at,
          name_client,
          guid_holding::text,
          guid_holding_pending::text,
          address,
          name_manager
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

    const currentFingerprint = fingerprintFromClientRow(clientRow);

    const existing = await client.query<ReviewRow>(
      `${REVIEW_SELECT} AND crr.guid_client = $1::uuid FOR UPDATE OF crr`,
      [input.guidClient.toLowerCase()],
    );
    const beforeRow = existing.rows[0] ?? null;
    const before = beforeRow ? toReviewRecord(beforeRow) : null;

    assertOptimisticVersion(before, input.expectedVersion);

    const isRecheck = Boolean(input.recheckConfirmed);

    if (
      input.reviewDecision === "propose_transfer" &&
      input.proposedManagerGuid &&
      input.proposedManagerGuid.toLowerCase() === clientRow.guid_manager.toLowerCase() &&
      !isMaintainingConfirmedTransfer(beforeRow, clientRow.guid_manager, input.proposedManagerGuid)
    ) {
      throw new ReviewServiceError(
        "Передача текущему же ответственному не имеет смысла; выберите другого менеджера или подтвердите текущего.",
        "VALIDATION",
      );
    }
    if (isRecheck) {
      if (!before || !before.isStale) {
        throw new ReviewServiceError(
          "Повторная проверка доступна только для устаревшей ревизии.",
          "VALIDATION",
        );
      }
    }

    let basisManagerGuid = before?.basisManagerGuid ?? clientRow.guid_manager;
    let basisSourceSha256 = before?.basisSourceSha256 ?? clientRow.source_sha256;
    let basisDataFingerprint = before?.basisDataFingerprint ?? currentFingerprint;
    let basisImportedAt = before?.basisImportedAt
      ? new Date(before.basisImportedAt)
      : clientRow.last_imported_at;
    let staleReason: string | null = beforeRow?.stale_reason ?? null;

    if (isRecheck) {
      const completingPriorTransfer = isMaintainingConfirmedTransfer(
        beforeRow,
        clientRow.guid_manager,
        input.proposedManagerGuid ?? beforeRow?.proposed_manager_guid,
      );
      basisSourceSha256 = clientRow.source_sha256;
      basisDataFingerprint = currentFingerprint;
      basisImportedAt = clientRow.last_imported_at;
      staleReason = null;
      basisManagerGuid = completingPriorTransfer
        ? beforeRow!.basis_manager_guid
        : clientRow.guid_manager;
    } else if (before && beforeRow) {
      const maintainingConfirmedTransfer = isMaintainingConfirmedTransfer(
        beforeRow,
        clientRow.guid_manager,
        input.proposedManagerGuid ?? beforeRow.proposed_manager_guid,
      );
      const managerChanged =
        clientRow.guid_manager.toLowerCase() !== before.basisManagerGuid.toLowerCase();
      const fingerprintChanged =
        before.basisDataFingerprint != null && currentFingerprint !== before.basisDataFingerprint;
      if (fingerprintChanged || (managerChanged && !maintainingConfirmedTransfer)) {
        staleReason = "Импорт изменил назначение или состав клиента.";
      }
    }

    let nextReviewState = input.reviewState;
    if (isRecheck) {
      if (!beforeRow) {
        throw new ReviewServiceError(
          "Повторная проверка доступна только для существующей записи ревизии.",
          "VALIDATION",
        );
      }
      nextReviewState = beforeRow.review_state;
    } else if (staleReason && input.reviewState === "completed") {
      nextReviewState = "needs_recheck";
    }

    const nextVersion = (before?.version ?? 0) + 1;
    const changeType = isRecheck ? "recheck" : before ? "update" : "create";

    const upserted = await client.query<Omit<ReviewRow, "current_manager_guid" | "current_source_sha256" | "current_imported_at" | "current_name_client" | "current_guid_holding" | "current_guid_holding_pending" | "current_address" | "current_name_manager" | "current_data_fingerprint">>(
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
          basis_data_fingerprint,
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
          $11,
          $12::timestamptz,
          $13,
          $14::uuid,
          $14::uuid
        )
        ON CONFLICT (guid_client) DO UPDATE SET
          review_state = EXCLUDED.review_state,
          review_decision = EXCLUDED.review_decision,
          comment = EXCLUDED.comment,
          proposed_manager_guid = EXCLUDED.proposed_manager_guid,
          assigned_reviewer_user_id = EXCLUDED.assigned_reviewer_user_id,
          due_at = EXCLUDED.due_at,
          version = EXCLUDED.version,
          basis_manager_guid = EXCLUDED.basis_manager_guid,
          basis_source_sha256 = EXCLUDED.basis_source_sha256,
          basis_data_fingerprint = EXCLUDED.basis_data_fingerprint,
          basis_imported_at = EXCLUDED.basis_imported_at,
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
          basis_data_fingerprint,
          basis_imported_at,
          stale_reason,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at,
          updated_at
      `,
      [
        input.guidClient.toLowerCase(),
        nextReviewState,
        input.reviewDecision ?? null,
        input.comment ?? null,
        input.proposedManagerGuid?.toLowerCase() ?? null,
        input.assignedReviewerUserId ?? null,
        dueAt,
        nextVersion,
        basisManagerGuid,
        basisSourceSha256,
        basisDataFingerprint,
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
      current_name_client: clientRow.name_client,
      current_guid_holding: clientRow.guid_holding,
      current_guid_holding_pending: clientRow.guid_holding_pending,
      current_address: clientRow.address,
      current_name_manager: clientRow.name_manager,
      current_data_fingerprint: currentFingerprint,
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
        changeType,
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
  const effectiveState = reviewEffectiveStateSql("onec_clients");
  const staleSql = reviewIsStaleSql("onec_clients");

  if (reviewState === "unreviewed") {
    whereClauses.push(`(${effectiveState}) = 'unreviewed'`);
  } else if (reviewState === "needs_recheck") {
    whereClauses.push(`(${effectiveState}) = 'needs_recheck'`);
  } else if (reviewState !== "any") {
    params.push(reviewState);
    whereClauses.push(`(${effectiveState}) = $${params.length}`);
    if (reviewState === "completed") {
      whereClauses.push(`NOT (${staleSql})`);
    } else if (reviewState === "in_progress" || reviewState === "awaiting_1c_fix") {
      whereClauses.push(`NOT (${staleSql})`);
    }
  }

  if (reviewDecision && reviewDecision !== "any") {
    params.push(reviewDecision);
    whereClauses.push(`crr.review_decision = $${params.length}`);
  }

  return { joinSql, whereClauses, params };
}
