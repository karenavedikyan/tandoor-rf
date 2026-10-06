import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import {
  ensureExchangeStateInitialized,
  getCommittedSnapshotSha,
  parseCommitUncertainRunId,
  resolveCommitUncertainFresh,
  resolveCommitUncertainOutcome,
  updateExchangeStateAfterApplyInTxn,
} from "../onec-exchange/state";
import { prepareJournalWarnings } from "../onec-exchange/warnings-journal";
import { IMPORT_ADVISORY_LOCK_KEY } from "./constants";
import {
  buildExtendedSnapshotJson,
  extendedBusinessDataEqual,
  isExtendedApplyPayload,
  isExtendedContractVerified,
  loadExistingExtendedSnapshots,
  readExtendedSnapshot,
  resolveExtendedRecordsForApply,
  summarizeExtendedFreshness,
} from "./extended-apply";
import type { ExtendedSnapshot } from "./extended-types";
import {
  countKnownOutletsMissingFromSnapshot,
  detectRegistryParentConflicts,
  extractConfirmedOutletGuidsFromSource,
} from "./outlet-identity";
import type { FieldPresenceState } from "./extended-presence";
import { loadOutletGuidRegistry, upsertOutletRegistryEntries } from "./outlet-registry";
import type { ParsedClientRecord, ValidatedClientsPayload } from "./types";
import {
  verificationFingerprintFromPayload,
  verifyApplyVerification,
} from "./import-verification-fingerprint";
import { resolveConfirmedHoldingForApply, resolveImportLinkMetadata } from "./manager-status";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import { rejectWholesaleCompositionPrepApply } from "./wholesale-composition";
import { assertOperatorImportJobRunnable } from "./import-job-guard";
import type { WholesaleEmployeeRoster } from "./employee-roster";
import { upsertWholesaleEmployeeRoster } from "./roster-upsert";

export type ImportTriggerSource = "manual" | "scheduled" | "operator_job" | "regular_update";

export const DB_CONNECT_TIMEOUT_MS = 5_000;

export type ApplyCounts = {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  extendedBlockedCount?: number;
  rosterNewCount?: number;
  rosterChangedCount?: number;
  rosterUnchangedCount?: number;
};

export type ApplyBlockSummary = {
  legacyApplied: true;
  extendedApplied: boolean;
  extendedBlockReason?: string | null;
  extendedAppliedCount?: number;
  extendedBlockedCount?: number;
  outletParentLinkConflicts?: number;
};

export type ApplyResult =
  | {
      ok: true;
      runId?: string;
      unchangedBundle?: true;
      counts: ApplyCounts;
      blockSummary?: ApplyBlockSummary;
      cleanupWarning?: string;
    }
  | {
      ok: false;
      code:
        | "IMPORT_LOCKED"
        | "STALE_RUNNING_IMPORT"
        | "RECORD_COUNT_DECREASED"
        | "GUID_SET_SHRINK"
        | "ROSTER_SHRINK_AMBIGUOUS"
        | "DATABASE_ERROR"
        | "COMMIT_UNCERTAIN"
        | "SUPERSEDED_BY_NEWER_IMPORT"
        | "APPLY_BLOCKED"
        | "VERIFICATION_FINGERPRINT_REQUIRED"
        | "VERIFICATION_FINGERPRINT_MISMATCH"
        | "VERIFICATION_PARAMETERS_MISMATCH"
        | "IMPORT_JOB_SUPERSEDED";
      message: string;
      runId?: string;
      actualFingerprint?: string;
    };

export type ApplyTestHooks = {
  afterRecordIndex?: number;
  failUnlock?: boolean;
  failCommit?: boolean;
  failAfterCommitConfirm?: boolean;
  failExchangeStateUpdate?: boolean;
  failRelease?: boolean;
  failPoolEnd?: boolean;
  onClientReady?: (client: PoolClient) => void;
  /** Test-only: pause after connection is ready, before import advisory lock acquisition. */
  beforeImportLock?: () => Promise<void>;
  /** Test-only: pause after import lock is held, before operator job gate and writes. */
  afterImportLock?: (client: PoolClient) => Promise<void>;
};

type ExistingClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  manager_roster_state: import("./extended-types").ClientManagerRosterState | null;
  address: string;
  telephone: string[];
};

class ClientConnectionFault extends Error {
  constructor() {
    super("Client connection fault.");
    this.name = "ClientConnectionFault";
  }
}

type ManagedClient = {
  client: PoolClient;
  readonly faulted: () => boolean;
  removeErrorListener: () => void;
};

type ApplyPhaseState = {
  lockHeld: boolean;
  runId?: string;
  commitAttempted: boolean;
  commitConfirmed: boolean;
  counts?: ApplyCounts;
  blockSummary?: ApplyBlockSummary;
};

const CLEANUP_LOCK_WARNING =
  "Import finished but advisory lock release failed during cleanup; verify no concurrent apply is running.";
const CLEANUP_RELEASE_WARNING =
  "Import finished but database connection release failed during cleanup.";
const CLEANUP_POOL_WARNING =
  "Import finished but database pool shutdown failed during cleanup.";

function telephoneEqual(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isBusinessDataEqual(existing: ExistingClientRow, incoming: ParsedClientRecord): boolean {
  return (
    existing.name_client === incoming.name_client &&
    (existing.guid_holding ?? null) === incoming.guid_holding &&
    existing.name_holding === incoming.name_holding &&
    existing.guid_manager === incoming.guid_manager &&
    existing.name_manager === incoming.name_manager &&
    existing.address === incoming.address &&
    telephoneEqual(existing.telephone, incoming.telephone)
  );
}

function isImportRecordEqual(
  existing: ExistingClientRow | undefined,
  incoming: ParsedClientRecord,
  previousExtendedSnapshot: unknown,
  nextExtendedSnapshot: ExtendedSnapshot | null,
): boolean {
  if (!existing) {
    return false;
  }
  if (!isBusinessDataEqual(existing, incoming)) {
    return false;
  }
  const previous = readExtendedSnapshot(previousExtendedSnapshot);
  if (nextExtendedSnapshot) {
    return extendedBusinessDataEqual(previous, nextExtendedSnapshot);
  }
  return true;
}

function mergeCleanupWarnings(existing: string | undefined, additions: string[]): string | undefined {
  const merged = [existing, ...additions].filter((value): value is string => Boolean(value));
  if (merged.length === 0) {
    return undefined;
  }
  return merged.join(" ");
}

function managePoolClient(client: PoolClient): ManagedClient {
  let faulted = false;
  const onError = () => {
    faulted = true;
  };
  client.on("error", onError);
  return {
    client,
    faulted: () => faulted,
    removeErrorListener: () => {
      client.removeListener("error", onError);
    },
  };
}

function assertClientUsable(managed: ManagedClient): void {
  if (managed.faulted()) {
    throw new ClientConnectionFault();
  }
}

async function queryManaged<T extends Record<string, unknown>>(
  managed: ManagedClient,
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  assertClientUsable(managed);
  const result = await managed.client.query<T>(text, params);
  assertClientUsable(managed);
  return result;
}

function resolveConnectionFault(state: ApplyPhaseState): ApplyResult {
  if (state.commitConfirmed && state.counts && state.runId) {
    return {
      ok: true,
      runId: state.runId,
      counts: state.counts,
      blockSummary: state.blockSummary,
      cleanupWarning:
        "Import committed successfully but the database connection failed afterward; verify the import run journal.",
    };
  }
  if (state.commitAttempted && !state.commitConfirmed) {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message: "Commit outcome is unknown; inspect the import run journal by runId before retrying.",
      runId: state.runId,
    };
  }
  return {
    ok: false,
    code: "DATABASE_ERROR",
    message: "Database connection failed during apply.",
    runId: state.runId,
  };
}

function isConnectionFault(error: unknown, managed?: ManagedClient): boolean {
  return error instanceof ClientConnectionFault || managed?.faulted() === true;
}

async function getLastSuccessfulRecordCount(managed: ManagedClient): Promise<number | null> {
  const result = await queryManaged<{ source_record_count: number | null }>(
    managed,
    `
      SELECT source_record_count
      FROM onec_client_import_runs
      WHERE status = 'success'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  return result.rows[0]?.source_record_count ?? null;
}

async function hasStaleRunningImport(
  managed: ManagedClient,
  excludeRunIds: string[] = [],
): Promise<boolean> {
  if (excludeRunIds.length === 0) {
    const result = await queryManaged<{ count: string }>(
      managed,
      `
        SELECT COUNT(*)::text AS count
        FROM onec_client_import_runs
        WHERE status = 'running'
      `,
    );
    return Number(result.rows[0]?.count ?? "0") > 0;
  }
  const result = await queryManaged<{ count: string }>(
    managed,
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
        AND NOT (id = ANY($1::uuid[]))
    `,
    [excludeRunIds],
  );
  return Number(result.rows[0]?.count ?? "0") > 0;
}

function journalWarningsForPayload(payload: ValidatedClientsPayload) {
  return prepareJournalWarnings(payload.warnings, { totalWarningCount: payload.warningCount });
}

type ApplyExtendedStats = {
  extendedAppliedCount: number;
  extendedBlockedCount: number;
  outletParentLinkConflicts: number;
  knownOutletsMissingFromSnapshot: number | null;
};

function buildApplyBlockSummary(
  extendedApply: boolean,
  contractVerified: boolean,
  stats: ApplyExtendedStats,
): ApplyBlockSummary | undefined {
  if (!extendedApply) {
    return undefined;
  }
  if (!contractVerified) {
    return {
      legacyApplied: true,
      extendedApplied: false,
      extendedBlockReason: "awaiting_live_json_verification",
      extendedAppliedCount: 0,
      extendedBlockedCount: stats.extendedBlockedCount,
      outletParentLinkConflicts: stats.outletParentLinkConflicts,
    };
  }
  if (stats.outletParentLinkConflicts > 0 || stats.extendedBlockedCount > 0) {
    return {
      legacyApplied: true,
      extendedApplied: false,
      extendedBlockReason:
        stats.outletParentLinkConflicts > 0
          ? "outlet_parent_link_conflict"
          : "extended_partially_blocked",
      extendedAppliedCount: stats.extendedAppliedCount,
      extendedBlockedCount: stats.extendedBlockedCount,
      outletParentLinkConflicts: stats.outletParentLinkConflicts,
    };
  }
  return {
    legacyApplied: true,
    extendedApplied: stats.extendedAppliedCount > 0,
    extendedBlockReason: null,
    extendedAppliedCount: stats.extendedAppliedCount,
    extendedBlockedCount: 0,
    outletParentLinkConflicts: 0,
  };
}

function mergeExtendedDiagnosticsForJournal(
  payload: ValidatedClientsPayload,
  extendedApply: boolean,
  contractVerified: boolean,
  stats: ApplyExtendedStats,
): string | null {
  if (!extendedApply) {
    return null;
  }
  const applyBlocks = buildApplyBlockSummary(extendedApply, contractVerified, stats);
  const base = payload.extendedDiagnostics;
  return JSON.stringify({
    ...(base ?? {}),
    holdingLinkValidationPolicy:
      payload.holdingLinkValidationPolicy ?? base?.holdingLinkValidationPolicy,
    wholesaleCompositionMode: payload.wholesaleCompositionMode ?? "standard",
    knownOutletsMissingFromSnapshot: stats.knownOutletsMissingFromSnapshot,
    outletParentLinkConflicts: stats.outletParentLinkConflicts,
    applyBlocks,
  });
}

async function loadApplyBlockSummaryFromJournal(
  databaseUrl: string,
  runId: string,
): Promise<ApplyBlockSummary | undefined> {
  const pool = createImportPool(databaseUrl);
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{ extended_diagnostics: { applyBlocks?: ApplyBlockSummary & { extendedBlockedCount?: number } } | null }>(
        `
          SELECT extended_diagnostics
          FROM onec_client_import_runs
          WHERE id = $1::uuid
        `,
        [runId],
      );
      const applyBlocks = result.rows[0]?.extended_diagnostics?.applyBlocks;
      if (!applyBlocks) {
        return undefined;
      }
      return {
        legacyApplied: applyBlocks.legacyApplied,
        extendedApplied: applyBlocks.extendedApplied,
        extendedBlockReason: applyBlocks.extendedBlockReason ?? null,
        extendedAppliedCount: applyBlocks.extendedAppliedCount,
        extendedBlockedCount: applyBlocks.extendedBlockedCount,
        outletParentLinkConflicts: applyBlocks.outletParentLinkConflicts,
      };
    } finally {
      client.release();
    }
  } catch {
    return undefined;
  } finally {
    await pool.end();
  }
}

async function recoverFromCommitUncertainty(
  managed: ManagedClient | undefined,
  phase: ApplyPhaseState,
  resolvedDatabaseUrl: string | undefined,
): Promise<ApplyResult> {
  if (managed && !managed.faulted()) {
    try {
      await managed.client.query("ROLLBACK");
    } catch {
      // Rollback is best-effort when commit confirmation was lost.
    }
    if (phase.lockHeld) {
      try {
        await managed.client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
        phase.lockHeld = false;
      } catch {
        // Fresh recovery acquires the shared lock on a healthy connection.
      }
    }
  }

  if (!phase.runId) {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message: "Commit outcome is unknown; inspect the import run journal by runId before retrying.",
      runId: phase.runId,
    };
  }

  if (!resolvedDatabaseUrl) {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message:
        "Commit outcome is unknown; recovery database connection is unavailable and apply block was not persisted.",
      runId: phase.runId,
    };
  }

  try {
    const resolution = await resolveCommitUncertainFresh(resolvedDatabaseUrl, phase.runId);
    if (resolution === "committed" && phase.counts) {
      const blockSummary =
        phase.blockSummary ??
        (resolvedDatabaseUrl
          ? await loadApplyBlockSummaryFromJournal(resolvedDatabaseUrl, phase.runId)
          : undefined);
      return {
        ok: true,
        runId: phase.runId,
        counts: phase.counts,
        blockSummary,
        cleanupWarning:
          "Import committed successfully but the database connection failed during commit confirmation; outcome was verified by runId.",
      };
    }
    return {
      ok: false,
      code: resolution === "still_uncertain" ? "COMMIT_UNCERTAIN" : "DATABASE_ERROR",
      message:
        resolution === "still_uncertain"
          ? "Commit outcome is unknown; inspect the import run journal by runId before retrying."
          : "Database apply failed.",
      runId: phase.runId,
    };
  } catch {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message:
        "Commit outcome is unknown; recovery on a fresh connection failed and apply block was not verified.",
      runId: phase.runId,
    };
  }
}

async function loadExistingClients(managed: ManagedClient): Promise<Map<string, ExistingClientRow>> {
  const result = await queryManaged<ExistingClientRow>(
    managed,
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        manager_roster_state,
        address,
        telephone
      FROM onec_clients
    `,
  );
  const map = new Map<string, ExistingClientRow>();
  for (const row of result.rows) {
    map.set(row.guid_client, {
      ...row,
      guid_holding: row.guid_holding,
      telephone: Array.isArray(row.telephone) ? row.telephone : [],
    });
  }
  return map;
}

async function linkOperatorImportJobRun(
  managed: ManagedClient,
  operatorImportJobId: string | undefined,
  runId: string | undefined,
): Promise<void> {
  if (!operatorImportJobId || !runId) {
    return;
  }
  await queryManaged(
    managed,
    `
      UPDATE onec_import_jobs
      SET import_run_id = $2::uuid
      WHERE id = $1::uuid AND status = 'running'
    `,
    [operatorImportJobId, runId],
  );
}

async function insertRejectedRunJournal(
  managed: ManagedClient,
  payload: ValidatedClientsPayload,
  errorCode: "RECORD_COUNT_DECREASED" | "GUID_SET_SHRINK" | "ROSTER_SHRINK_AMBIGUOUS",
  journal: ApplyJournalContext,
): Promise<string | undefined> {
  const preparedWarnings = journalWarningsForPayload(payload);
  const runInsert = await queryManaged<{ id: string }>(
    managed,
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        trigger_source,
        parent_run_id,
        source_sha256,
        source_byte_size,
        source_record_count,
        warning_count,
        warnings,
        warnings_truncated,
        finished_at,
        error_code
      )
      VALUES ('failed', 'apply', $1, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, NOW(), $9)
      RETURNING id::text
    `,
    [
      journal.triggerSource ?? null,
      journal.parentRunId ?? null,
      payload.sha256,
      payload.byteSize,
      payload.recordCount,
      preparedWarnings.warningCount,
      preparedWarnings.warningsJson,
      preparedWarnings.warningsTruncated,
      errorCode,
    ],
  );
  return runInsert.rows[0]?.id;
}

type ApplyJournalContext = {
  triggerSource?: ImportTriggerSource;
  parentRunId?: string;
};

export function attachManagedPoolClient(client: PoolClient): ManagedClient {
  return managePoolClient(client);
}

async function releaseAdvisoryLock(
  managed: ManagedClient,
  testHooks?: ApplyTestHooks,
): Promise<void> {
  if (testHooks?.failUnlock) {
    throw new Error("Advisory unlock failed.");
  }
  await queryManaged(managed, "SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
}

export function createImportPool(databaseUrl: string): Pool {
  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
  pool.on("error", () => {
    // Idle pool connection errors are handled per checkout; avoid crashing the process.
  });
  return pool;
}

async function safeUnlockAdvisoryLock(managed: ManagedClient | undefined, lockHeld: boolean): Promise<string | undefined> {
  if (!managed || !lockHeld || managed.faulted()) {
    return undefined;
  }
  try {
    await queryManaged(managed, "SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    return undefined;
  } catch {
    return CLEANUP_LOCK_WARNING;
  }
}

function safeReleaseClient(
  managed: ManagedClient | undefined,
  testHooks?: ApplyTestHooks,
): string | undefined {
  if (!managed) {
    return undefined;
  }
  managed.removeErrorListener();
  try {
    if (testHooks?.failRelease) {
      throw new Error("Release failed.");
    }
    if (managed.faulted()) {
      managed.client.release(new Error("Connection fault."));
    } else {
      managed.client.release();
    }
    return undefined;
  } catch {
    try {
      managed.client.release(new Error("Cleanup release failure."));
    } catch {
      // ignore secondary release failure
    }
    return CLEANUP_RELEASE_WARNING;
  }
}

async function safeEndPool(pool: Pool | undefined, testHooks?: ApplyTestHooks): Promise<string | undefined> {
  if (!pool) {
    return undefined;
  }
  try {
    if (testHooks?.failPoolEnd) {
      throw new Error("Pool shutdown failed.");
    }
    await pool.end();
    return undefined;
  } catch {
    return CLEANUP_POOL_WARNING;
  }
}

function appendCleanupWarnings(result: ApplyResult, cleanupWarnings: string[]): ApplyResult {
  if (!result.ok || cleanupWarnings.length === 0) {
    return result;
  }
  return {
    ...result,
    cleanupWarning: mergeCleanupWarnings(result.cleanupWarning, cleanupWarnings),
  };
}

function rejectMissingValidatedRosterStates(
  payload: ValidatedClientsPayload,
): { code: "APPLY_BLOCKED"; message: string } | null {
  if (payload.employeeRosterSourceSha256 == null) {
    return null;
  }
  const extendedByGuid = new Map(
    (payload.extendedRecords ?? []).map((record) => [record.guid_client, record]),
  );
  for (const record of payload.records) {
    const state =
      extendedByGuid.get(record.guid_client)?.managerRosterState ?? record.managerRosterState;
    if (state == null) {
      return {
        code: "APPLY_BLOCKED",
        message:
          "Validated manager roster state is missing for one or more records; re-run validation with the employee roster.",
      };
    }
  }
  return null;
}

export async function applyClientsImport(options: {
  databaseUrl?: string;
  payload: ValidatedClientsPayload;
  client?: PoolClient;
  lockAlreadyHeld?: boolean;
  retainLock?: boolean;
  triggerSource?: ImportTriggerSource;
  parentRunId?: string;
  excludeRunIds?: string[];
  expectedCommittedSha256?: string | null;
  syncExchangeState?: boolean;
  wholesaleCompositionPrep?: boolean;
  expectedVerificationFingerprint: string;
  holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256?: string | null;
  /** Controlled wholesale baseline replacement only; skips shrink guards, not verification. */
  baselineReplacementApply?: boolean;
  /** Explicit clean reload after purge; skips shrink guards, not verification. */
  cleanReloadApply?: boolean;
  /** Original full clients file SHA256 for baseline extended-contract gate (not accepted projection SHA). */
  originalClientsSourceSha256?: string;
  /** When true, caller owns BEGIN/COMMIT; apply must not commit or rollback the connection. */
  participatingTransaction?: boolean;
  /** Operator job id; validated only after import advisory lock is held on this connection. */
  operatorImportJobId?: string;
  /** When set with matching payload.employeeRosterSourceSha256, upserts wholesale roster in the same transaction. */
  wholesaleEmployeeRoster?: WholesaleEmployeeRoster;
  testHooks?: ApplyTestHooks;
}): Promise<ApplyResult> {
  const prepApplyRejection = rejectWholesaleCompositionPrepApply({
    wholesaleCompositionPrep: options.wholesaleCompositionPrep,
    payload: options.payload,
  });
  if (prepApplyRejection) {
    return {
      ok: false,
      code: prepApplyRejection.code,
      message: prepApplyRejection.message,
    };
  }

  const verificationFailure = verifyApplyVerification({
    expectedVerificationFingerprint: options.expectedVerificationFingerprint,
    payload: options.payload,
    holdingLinkValidationPolicy: options.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: options.employeeRosterSourceSha256,
  });
  if (verificationFailure) {
    return {
      ok: false,
      code: verificationFailure.code,
      message: verificationFailure.message,
      actualFingerprint:
        verificationFailure.code === "VERIFICATION_FINGERPRINT_MISMATCH"
          ? verificationFailure.actualFingerprint
          : undefined,
    };
  }
  const missingRosterState = rejectMissingValidatedRosterStates(options.payload);
  if (missingRosterState) {
    return {
      ok: false,
      code: missingRosterState.code,
      message: missingRosterState.message,
    };
  }
  const verifiedFingerprint = verificationFingerprintFromPayload({ payload: options.payload });

  let pool: Pool | undefined;
  let managed: ManagedClient | undefined;
  let ownsPool = false;
  let ownsClient = false;
  const applyDatabaseUrl = options.databaseUrl ?? getDatabaseUrl() ?? undefined;
  const recoveryDatabaseUrl = getDatabaseUrl() ?? applyDatabaseUrl;
  const phase: ApplyPhaseState = {
    lockHeld: options.lockAlreadyHeld === true,
    commitAttempted: false,
    commitConfirmed: false,
  };
  let outcome: ApplyResult | undefined;
  const cleanupWarnings: string[] = [];
  const journal: ApplyJournalContext = {
    triggerSource: options.triggerSource,
    parentRunId: options.parentRunId,
  };

  if (options.client) {
    managed = managePoolClient(options.client);
    options.testHooks?.onClientReady?.(managed.client);
  } else {
    if (!applyDatabaseUrl) {
      return { ok: false, code: "DATABASE_ERROR", message: "Database configuration failed." };
    }
    try {
      pool = createImportPool(applyDatabaseUrl);
      ownsPool = true;
    } catch {
      return { ok: false, code: "DATABASE_ERROR", message: "Database configuration failed." };
    }

    try {
      const connected = await pool.connect();
      managed = managePoolClient(connected);
      ownsClient = true;
      options.testHooks?.onClientReady?.(managed.client);
    } catch {
      const poolWarning = await safeEndPool(pool, options.testHooks);
      if (poolWarning) {
        cleanupWarnings.push(poolWarning);
      }
      return { ok: false, code: "DATABASE_ERROR", message: "Database connection failed." };
    }
  }

  try {
    await options.testHooks?.beforeImportLock?.();

    if (!options.lockAlreadyHeld) {
      const lock = await queryManaged<{ locked: boolean }>(
        managed,
        "SELECT pg_try_advisory_lock($1) AS locked",
        [IMPORT_ADVISORY_LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) {
        outcome = { ok: false, code: "IMPORT_LOCKED", message: "Another clients import is already running." };
      } else {
        phase.lockHeld = true;
      }
    }

    if (!outcome) {
      await options.testHooks?.afterImportLock?.(managed.client);

      if (options.operatorImportJobId) {
        const runnable = await assertOperatorImportJobRunnable(managed.client, options.operatorImportJobId);
        if (!runnable) {
          outcome = {
            ok: false,
            code: "IMPORT_JOB_SUPERSEDED",
            message: "Import job is no longer runnable.",
          };
        }
      }
    }

    if (!outcome) {
      await ensureExchangeStateInitialized(managed.client);
      const blocked = await queryManaged<{ apply_blocked: boolean; apply_blocked_reason: string | null }>(
        managed,
        "SELECT apply_blocked, apply_blocked_reason FROM onec_exchange_state WHERE id = 1",
      );
      if (blocked.rows[0]?.apply_blocked) {
        const uncertainRunId = parseCommitUncertainRunId(blocked.rows[0].apply_blocked_reason);
        if (uncertainRunId) {
          const resolution = await resolveCommitUncertainOutcome(managed.client, uncertainRunId);
          if (resolution === "committed") {
            // Block cleared; continue apply checks below.
          } else if (resolution === "still_uncertain") {
            outcome = {
              ok: false,
              code: "APPLY_BLOCKED",
              message:
                blocked.rows[0].apply_blocked_reason ??
                "Import apply is blocked until the previous uncertain outcome is resolved.",
            };
          } else {
            // not_committed — block cleared, continue.
          }
        } else {
          outcome = {
            ok: false,
            code: "APPLY_BLOCKED",
            message:
              blocked.rows[0].apply_blocked_reason ??
              "Import apply is blocked until the previous uncertain outcome is resolved.",
          };
        }
      }
    }

    if (!outcome && options.expectedCommittedSha256 !== undefined) {
      const committedSha = await getCommittedSnapshotSha(managed.client);
      if (committedSha !== options.expectedCommittedSha256) {
        outcome = {
          ok: false,
          code: "SUPERSEDED_BY_NEWER_IMPORT",
          message: "A newer import was committed after this snapshot was verified.",
        };
      }
    }

    if (!outcome) {
      if (await hasStaleRunningImport(managed, options.excludeRunIds ?? [])) {
        outcome = {
          ok: false,
          code: "STALE_RUNNING_IMPORT",
          message: "A previous import run is still marked as running; resolve it before applying again.",
        };
      } else if (options.triggerSource === "regular_update" && options.wholesaleEmployeeRoster) {
        const { runRegularUpdateApplyGate } = await import("../onec-regular-update/regular-update-apply-gate");
        const gate = await runRegularUpdateApplyGate(managed.client, {
          payload: options.payload,
          roster: options.wholesaleEmployeeRoster,
          expectedVerificationFingerprint: options.expectedVerificationFingerprint,
          holdingLinkValidationPolicy: options.holdingLinkValidationPolicy,
          employeeRosterSourceSha256: options.employeeRosterSourceSha256,
        });
        if (!gate.ok) {
          if (gate.code === "ROSTER_SHRINK_AMBIGUOUS") {
            phase.runId = await insertRejectedRunJournal(
              managed,
              options.payload,
              "ROSTER_SHRINK_AMBIGUOUS",
              journal,
            );
            await linkOperatorImportJobRun(managed, options.operatorImportJobId, phase.runId);
          }
          outcome = {
            ok: false,
            code: gate.code,
            message: gate.message,
            runId: phase.runId,
            actualFingerprint:
              gate.code === "VERIFICATION_FINGERPRINT_MISMATCH" ? gate.actualFingerprint : undefined,
          };
        } else if (gate.unchangedBundle) {
          outcome = {
            ok: true,
            unchangedBundle: true,
            counts: {
              newCount: 0,
              changedCount: 0,
              unchangedCount: options.payload.recordCount,
            },
          };
        }
      }
    }

    if (!outcome) {
      const skipShrinkGuards =
        options.baselineReplacementApply === true || options.cleanReloadApply === true;
      if (!skipShrinkGuards) {
          const lastSuccessfulCount = await getLastSuccessfulRecordCount(managed);
          if (
            lastSuccessfulCount !== null &&
            options.payload.recordCount < lastSuccessfulCount
          ) {
            phase.runId = await insertRejectedRunJournal(
              managed,
              options.payload,
              "RECORD_COUNT_DECREASED",
              journal,
            );
            await linkOperatorImportJobRun(managed, options.operatorImportJobId, phase.runId);
            outcome = {
              ok: false,
              code: "RECORD_COUNT_DECREASED",
              message: "Source record count decreased compared to the last successful import.",
              runId: phase.runId,
            };
          } else {
            const incomingGuids = new Set(
              options.payload.records.map((record) => record.guid_client),
            );
            const activeExisting = await queryManaged<{ guid_client: string }>(
              managed,
              `
                SELECT guid_client::text
                FROM onec_clients
                WHERE COALESCE(baseline_status, 'active') = 'active'
              `,
            );
            const missingGuids = activeExisting.rows
              .map((row) => row.guid_client)
              .filter((guid) => !incomingGuids.has(guid));
            if (missingGuids.length > 0) {
              phase.runId = await insertRejectedRunJournal(
                managed,
                options.payload,
                "GUID_SET_SHRINK",
                journal,
              );
              await linkOperatorImportJobRun(managed, options.operatorImportJobId, phase.runId);
              outcome = {
                ok: false,
                code: "GUID_SET_SHRINK",
                message: "Incoming snapshot is missing client IDs present in the last successful import.",
                runId: phase.runId,
              };
            }
          }
      }

      if (!outcome) {
        const existing = await loadExistingClients(managed);
          const preparedWarnings = journalWarningsForPayload(options.payload);
          const runInsert = await queryManaged<{ id: string }>(
            managed,
            `
              INSERT INTO onec_client_import_runs (
                status,
                mode,
                trigger_source,
                parent_run_id,
                source_sha256,
                source_byte_size,
                source_record_count,
                warning_count,
                warnings,
                warnings_truncated,
                verification_fingerprint
              )
              VALUES ('running', 'apply', $1, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9)
              RETURNING id::text
            `,
            [
              journal.triggerSource ?? null,
              journal.parentRunId ?? null,
              options.payload.sha256,
              options.payload.byteSize,
              options.payload.recordCount,
              preparedWarnings.warningCount,
              preparedWarnings.warningsJson,
              preparedWarnings.warningsTruncated,
              verifiedFingerprint,
            ],
          );
          phase.runId = runInsert.rows[0]?.id;

          await linkOperatorImportJobRun(managed, options.operatorImportJobId, phase.runId);

          const participating = options.participatingTransaction === true;
          if (!participating) {
            await queryManaged(managed, "BEGIN");
          }

          const extendedApply = isExtendedApplyPayload(options.payload);
          let contractVerified = false;
          if (
            (options.baselineReplacementApply || options.cleanReloadApply) &&
            options.originalClientsSourceSha256
          ) {
            const { resolveBaselineExtendedContractVerified } = await import("./baseline-extended-contract");
            contractVerified = await resolveBaselineExtendedContractVerified({
              client: managed.client,
              payload: options.payload,
              clientsSourceSha256: options.originalClientsSourceSha256,
            });
          } else {
            contractVerified = isExtendedContractVerified(options.payload);
          }
          const extendedRecords = resolveExtendedRecordsForApply(options.payload);
          const previousExtended = await loadExistingExtendedSnapshots(managed.client);
          const outletRegistry = await loadOutletGuidRegistry(managed.client);
          const importTimestamp = new Date().toISOString();

          let newCount = 0;
          let changedCount = 0;
          let unchangedCount = 0;
          let extendedBlockedCount = 0;
          let extendedAppliedCount = 0;
          let outletParentLinkConflicts = 0;
          let knownOutletsMissingFromSnapshot = 0;
          let missingOutletsChecked = false;

          for (let index = 0; index < options.payload.records.length; index += 1) {
            const record = options.payload.records[index]!;
            const extendedRecord = extendedRecords.get(record.guid_client);
            const confirmedHolding = extendedRecord
              ? resolveConfirmedHoldingForApply(extendedRecord)
              : { guid_holding: record.guid_holding, name_holding: record.name_holding };
            const applyRecord = { ...record, ...confirmedHolding };
            const current = existing.get(applyRecord.guid_client);
            const rosterLoadedInPayload = options.payload.employeeRosterSourceSha256 != null;
            const incomingManagerRosterState =
              extendedRecord?.managerRosterState ??
              record.managerRosterState ??
              "roster_not_loaded";
            const linkMetadata = resolveImportLinkMetadata(extendedRecord, {
              incomingManagerGuid: applyRecord.guid_manager,
              incomingManagerRosterState,
              previousManagerGuid: current?.guid_manager ?? null,
              previousManagerRosterState: current?.manager_roster_state ?? null,
              rosterLoadedInPayload,
            });
            const previousRow = previousExtended.get(record.guid_client);
            const previousSnapshot = previousRow?.extended_snapshot;

            let extendedSnapshotJson: ExtendedSnapshot | null = null;
            if (extendedRecord && contractVerified) {
              const parentConflicts = detectRegistryParentConflicts(
                record.guid_client,
                extendedRecord.retailOutlets,
                outletRegistry,
              );
              if (parentConflicts.length > 0) {
                extendedBlockedCount += 1;
                outletParentLinkConflicts += parentConflicts.length;
              } else {
                extendedSnapshotJson = buildExtendedSnapshotJson(
                  extendedRecord,
                  previousSnapshot,
                  options.payload.sha256,
                  importTimestamp,
                  { contractVerified: true },
                );
                extendedAppliedCount += 1;
              }
            } else if (extendedRecord && !contractVerified) {
              extendedBlockedCount += 1;
            }

            if (!current) {
              newCount += 1;
            } else if (
              isImportRecordEqual(current, applyRecord, previousSnapshot, extendedSnapshotJson)
            ) {
              unchangedCount += 1;
            } else {
              changedCount += 1;
            }

            const hasPreviousExtended = Boolean(previousRow?.extended_snapshot);
            const freshnessFromSnapshot = extendedSnapshotJson
              ? summarizeExtendedFreshness(extendedSnapshotJson).extendedFreshnessState
              : null;
            const extendedImportedAt = extendedSnapshotJson
              ? extendedSnapshotJson.importedAt
              : null;
            const extendedFreshnessState = extendedSnapshotJson
              ? freshnessFromSnapshot
              : hasPreviousExtended
                ? "preserved_from_previous"
                : null;

            await queryManaged(
              managed,
              `
                INSERT INTO onec_clients (
                  guid_client,
                  name_client,
                  guid_holding,
                  name_holding,
                  guid_manager,
                  name_manager,
                  address,
                  telephone,
                  source_sha256,
                  is_holding,
                  guid_regional_manager,
                  name_regional_manager,
                  guid_hardware_manager,
                  name_hardware_manager,
                  guid_head_sales,
                  name_head_sales,
                  extended_format_version,
                  extended_source_sha256,
                  extended_snapshot,
                  extended_imported_at,
                  extended_freshness_state,
                  holding_link_state,
                  guid_holding_pending,
                  manager_roster_state,
                  first_imported_at,
                  last_imported_at,
                  updated_at
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
                  $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::timestamptz, $21,
                  $22, $23::uuid, $24,
                  NOW(), NOW(), NOW()
                )
                ON CONFLICT (guid_client) DO UPDATE SET
                  name_client = EXCLUDED.name_client,
                  guid_holding = EXCLUDED.guid_holding,
                  name_holding = EXCLUDED.name_holding,
                  guid_manager = EXCLUDED.guid_manager,
                  name_manager = EXCLUDED.name_manager,
                  address = EXCLUDED.address,
                  telephone = EXCLUDED.telephone,
                  source_sha256 = EXCLUDED.source_sha256,
                  is_holding = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.is_holding
                    ELSE onec_clients.is_holding
                  END,
                  guid_regional_manager = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.guid_regional_manager
                    ELSE onec_clients.guid_regional_manager
                  END,
                  name_regional_manager = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.name_regional_manager
                    ELSE onec_clients.name_regional_manager
                  END,
                  guid_hardware_manager = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.guid_hardware_manager
                    ELSE onec_clients.guid_hardware_manager
                  END,
                  name_hardware_manager = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.name_hardware_manager
                    ELSE onec_clients.name_hardware_manager
                  END,
                  guid_head_sales = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.guid_head_sales
                    ELSE onec_clients.guid_head_sales
                  END,
                  name_head_sales = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.name_head_sales
                    ELSE onec_clients.name_head_sales
                  END,
                  extended_format_version = COALESCE(EXCLUDED.extended_format_version, onec_clients.extended_format_version),
                  extended_source_sha256 = COALESCE(EXCLUDED.extended_source_sha256, onec_clients.extended_source_sha256),
                  extended_snapshot = COALESCE(EXCLUDED.extended_snapshot, onec_clients.extended_snapshot),
                  extended_imported_at = CASE
                    WHEN EXCLUDED.extended_snapshot IS NOT NULL THEN EXCLUDED.extended_imported_at
                    WHEN EXCLUDED.extended_freshness_state = 'preserved_from_previous' THEN onec_clients.extended_imported_at
                    ELSE onec_clients.extended_imported_at
                  END,
                  extended_freshness_state = COALESCE(EXCLUDED.extended_freshness_state, onec_clients.extended_freshness_state),
                  holding_link_state = EXCLUDED.holding_link_state,
                  guid_holding_pending = EXCLUDED.guid_holding_pending,
                  manager_roster_state = EXCLUDED.manager_roster_state,
                  last_imported_at = NOW(),
                  updated_at = CASE
                    WHEN onec_clients.name_client IS DISTINCT FROM EXCLUDED.name_client
                      OR onec_clients.guid_holding IS DISTINCT FROM EXCLUDED.guid_holding
                      OR onec_clients.name_holding IS DISTINCT FROM EXCLUDED.name_holding
                      OR onec_clients.guid_manager IS DISTINCT FROM EXCLUDED.guid_manager
                      OR onec_clients.name_manager IS DISTINCT FROM EXCLUDED.name_manager
                      OR onec_clients.address IS DISTINCT FROM EXCLUDED.address
                      OR onec_clients.telephone IS DISTINCT FROM EXCLUDED.telephone
                      OR (EXCLUDED.extended_snapshot IS NOT NULL
                        AND onec_clients.extended_snapshot IS DISTINCT FROM EXCLUDED.extended_snapshot)
                    THEN NOW()
                    ELSE onec_clients.updated_at
                  END
              `,
              [
                applyRecord.guid_client,
                applyRecord.name_client,
                applyRecord.guid_holding,
                applyRecord.name_holding,
                applyRecord.guid_manager,
                applyRecord.name_manager,
                applyRecord.address,
                JSON.stringify(record.telephone),
                options.payload.sha256,
                extendedSnapshotJson?.isHolding ?? null,
                extendedSnapshotJson?.regionalManager.guid ?? null,
                extendedSnapshotJson?.regionalManager.name ?? "",
                extendedSnapshotJson?.hardwareManager.guid ?? null,
                extendedSnapshotJson?.hardwareManager.name ?? "",
                extendedSnapshotJson?.headOfSales.guid ?? null,
                extendedSnapshotJson?.headOfSales.name ?? "",
                extendedSnapshotJson ? "extended_v1" : null,
                extendedSnapshotJson?.sourceSha256 ?? null,
                extendedSnapshotJson ? JSON.stringify(extendedSnapshotJson) : null,
                extendedImportedAt,
                extendedFreshnessState,
                linkMetadata.holdingLinkState,
                linkMetadata.guidHoldingPending,
                linkMetadata.managerRosterState,
              ],
            );

            if (extendedSnapshotJson) {
              const outletsInCurrentExport = extendedSnapshotJson.currentRetailOutlets.filter(
                (outlet) => outlet.provenance.freshness === "current",
              );
              await upsertOutletRegistryEntries(
                managed.client,
                record.guid_client,
                outletsInCurrentExport,
              );
              const retailOutletsPresence = extendedRecord?.fieldPresence.retailOutlets as
                | FieldPresenceState
                | undefined;
              if (
                retailOutletsPresence === "present" ||
                retailOutletsPresence === "missing" ||
                retailOutletsPresence === "explicit_empty" ||
                retailOutletsPresence === "explicit_null"
              ) {
                missingOutletsChecked = true;
                const guidsInCurrentExport =
                  retailOutletsPresence === "present" && extendedRecord
                    ? extractConfirmedOutletGuidsFromSource(extendedRecord.retailOutlets)
                    : new Set<string>();
                knownOutletsMissingFromSnapshot += countKnownOutletsMissingFromSnapshot(
                  record.guid_client,
                  guidsInCurrentExport,
                  outletRegistry,
                );
              }
              for (const outlet of outletsInCurrentExport) {
                if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
                  outletRegistry.set(outlet.guidStore.toLowerCase(), {
                    guid_store: outlet.guidStore,
                    guid_client: record.guid_client,
                    is_closed: outlet.closed,
                    last_source_sha256: outlet.provenance.sourceSha256,
                    last_imported_at: outlet.provenance.importedAt,
                    closure_history: outlet.closureHistory,
                  });
                }
              }
            }

            if (options.testHooks?.afterRecordIndex === index) {
              throw new Error("Simulated apply failure after record write.");
            }
          }

          const applyExtendedStats: ApplyExtendedStats = {
            extendedAppliedCount,
            extendedBlockedCount,
            outletParentLinkConflicts,
            knownOutletsMissingFromSnapshot: missingOutletsChecked ? knownOutletsMissingFromSnapshot : null,
          };
          const extendedDiagnosticsJson = mergeExtendedDiagnosticsForJournal(
            options.payload,
            extendedApply,
            contractVerified,
            applyExtendedStats,
          );
          const sourceFormatVersion = options.payload.sourceFormat ?? "legacy";

          phase.blockSummary = buildApplyBlockSummary(extendedApply, contractVerified, applyExtendedStats);

          let rosterNewCount: number | undefined;
          let rosterChangedCount: number | undefined;
          let rosterUnchangedCount: number | undefined;
          if (options.wholesaleEmployeeRoster) {
            const payloadRosterSha = options.payload.employeeRosterSourceSha256?.toLowerCase() ?? null;
            const applyRosterSha = options.wholesaleEmployeeRoster.sourceSha256.toLowerCase();
            if (!payloadRosterSha || payloadRosterSha !== applyRosterSha) {
              throw new Error("Wholesale employee roster SHA mismatch between payload and apply input.");
            }
            const rosterCounts = await upsertWholesaleEmployeeRoster(
              managed.client,
              options.wholesaleEmployeeRoster,
            );
            rosterNewCount = rosterCounts.newCount;
            rosterChangedCount = rosterCounts.changedCount;
            rosterUnchangedCount = rosterCounts.unchangedCount;
          }

          await queryManaged(
            managed,
            `
              UPDATE onec_client_import_runs
              SET
                status = 'success',
                finished_at = NOW(),
                new_count = $2,
                changed_count = $3,
                unchanged_count = $4,
                error_code = NULL,
                source_format_version = $5,
                extended_diagnostics = $6::jsonb
              WHERE id = $1
            `,
            [phase.runId, newCount, changedCount, unchangedCount, sourceFormatVersion, extendedDiagnosticsJson],
          );

          if (options.syncExchangeState !== false) {
            if (options.testHooks?.failExchangeStateUpdate) {
              throw new Error("Simulated exchange state update failure.");
            }
            await updateExchangeStateAfterApplyInTxn(managed.client, {
              sha256: options.payload.sha256,
              acceptedBaselineSha256: options.payload.sha256,
            });
          }

          phase.counts = {
            newCount,
            changedCount,
            unchangedCount,
            ...(extendedBlockedCount > 0 ? { extendedBlockedCount } : {}),
            ...(rosterNewCount !== undefined ? { rosterNewCount } : {}),
            ...(rosterChangedCount !== undefined ? { rosterChangedCount } : {}),
            ...(rosterUnchangedCount !== undefined ? { rosterUnchangedCount } : {}),
          };
          if (!participating) {
            phase.commitAttempted = true;
            if (options.testHooks?.failCommit) {
              throw new Error("Simulated commit response loss.");
            }

            await queryManaged(managed, "COMMIT");
            phase.commitConfirmed = true;
          }

          if (options.testHooks?.failAfterCommitConfirm) {
            throw new ClientConnectionFault();
          }

          let postCommitCleanupWarning: string | undefined;
          if (!options.retainLock) {
            try {
              await releaseAdvisoryLock(managed, options.testHooks);
              phase.lockHeld = false;
            } catch {
              postCommitCleanupWarning =
                "Import committed successfully but advisory lock release failed; verify no concurrent apply is running.";
            }
          }

          outcome = {
            ok: true,
            runId: phase.runId!,
            counts: phase.counts,
            blockSummary: phase.blockSummary,
            cleanupWarning: postCommitCleanupWarning,
          };
        }
      }
  } catch (error) {
    if (phase.commitAttempted && !phase.commitConfirmed) {
      outcome = await recoverFromCommitUncertainty(managed, phase, recoveryDatabaseUrl);
    } else if (isConnectionFault(error, managed)) {
      outcome = resolveConnectionFault(phase);
    } else {
      if (managed && !managed.faulted() && options.participatingTransaction !== true) {
        try {
          await managed.client.query("ROLLBACK");
        } catch {
          // Rollback is best-effort; connection loss does not prove rollback.
        }

        if (phase.runId) {
          try {
            await managed.client.query(
              `
                UPDATE onec_client_import_runs
                SET status = 'failed', finished_at = NOW(), error_code = 'DATABASE_ERROR'
                WHERE id = $1 AND status = 'running'
              `,
              [phase.runId],
            );
          } catch {
            // ignore journal failure
          }
        }
      }

      outcome = { ok: false, code: "DATABASE_ERROR", message: "Database apply failed.", runId: phase.runId };
    }
  } finally {
    if (!options.retainLock) {
      const unlockWarning = await safeUnlockAdvisoryLock(managed, phase.lockHeld);
      if (unlockWarning) {
        cleanupWarnings.push(unlockWarning);
        phase.lockHeld = false;
      }
    }

    if (ownsClient) {
      const releaseWarning = safeReleaseClient(managed, options.testHooks);
      if (releaseWarning) {
        cleanupWarnings.push(releaseWarning);
      }
    }
    managed = undefined;

    if (ownsPool) {
      const poolWarning = await safeEndPool(pool, options.testHooks);
      if (poolWarning) {
        cleanupWarnings.push(poolWarning);
      }
    }
    pool = undefined;
  }

  return appendCleanupWarnings(
    outcome ?? { ok: false, code: "DATABASE_ERROR", message: "Database apply failed.", runId: phase.runId },
    cleanupWarnings,
  );
}
