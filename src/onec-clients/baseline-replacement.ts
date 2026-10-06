import type { PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { applyClientsImport, createImportPool } from "./apply";
import {
  archiveClientsNotInAccepted,
  extractBaselineApplyResultMeta,
  findDryRunByFingerprint,
  findSuccessfulBaselineApplyByFingerprint,
  loadActiveBaselineGuids,
  loadActiveExtendedContractConfirmationSha256,
  storeExtendedContractConfirmation,
  upsertQuarantineRecords,
} from "./baseline-replacement-db";
import { resolveBaselineCommitUncertainFresh } from "./baseline-replacement-commit-recovery";
import {
  captureDbBaselineStateConsistent,
  captureDbBaselineStateWithDependencies,
  computeDbBaselineStateSha256,
} from "./baseline-replacement-db-state";
import {
  computeAcceptedCompositionSha256,
  computeBaselineReplacementFingerprint,
} from "./baseline-replacement-fingerprint";
import {
  capturePreApplySnapshotV3,
  isPreApplySnapshotV3,
  restorePreApplySnapshotV3,
} from "./baseline-replacement-snapshot";
import { updateExchangeStateAfterApplyInTxn } from "../onec-exchange/state";
import { buildBaselineReplacementPlan } from "./baseline-replacement-plan";
import {
  buildExcludedArchiveDependencyReport,
  checkBaselineReplacementMigrationReadiness,
  loadArchiveDependencyContext,
} from "./baseline-replacement-preflight";
import {
  buildExtendedContractConfirmation,
  extendedContractConfirmationSha256 as computeExtendedContractConfirmationSha256,
  resolveExtendedContractVerificationForBaseline,
} from "./extended-contract-gate";
import { verificationFingerprintFromPayload } from "./import-verification-fingerprint";
import { tryAcquireImportLock, releaseImportLock } from "./import-lock";
import { parseQuarantineManifestBytes } from "./quarantine-manifest";
import { projectAcceptedClientsWithQuarantine } from "./quarantine-projection";
import { sha256Hex } from "./sha256";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { ValidatedClientsPayload } from "./types";
import { parseWholesaleEmployeeRosterBytes } from "./employee-roster";

export type BaselineReplacementMode = "dry_run" | "apply" | "rollback";

export type BaselineReplacementResult =
  | {
      ok: true;
      mode: BaselineReplacementMode;
      durationMs: number;
      plan?: import("./baseline-replacement-plan").BaselineReplacementPlan;
      apply?: {
        runId: string;
        archivedCount: number;
        quarantinedCount: number;
        importRunId: string;
        restoredCount?: number;
      };
    }
  | {
      ok: false;
      mode: BaselineReplacementMode;
      durationMs: number;
      code: string;
      message: string;
      actualFingerprint?: string;
      plan?: import("./baseline-replacement-plan").BaselineReplacementPlan;
    };

export type RunBaselineReplacementOptions = {
  databaseUrl?: string;
  mode: BaselineReplacementMode;
  clientsBytes: Buffer;
  employeeRosterBytes?: Buffer;
  quarantineManifestBytes: Buffer;
  holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
  expectedFingerprint?: string;
  confirmExtendedContract?: boolean;
  operatorReference?: string;
  operatorNote?: string;
  rollbackRunId?: string;
  testHooks?: {
    failCommit?: boolean;
    failAfterCommitConfirm?: boolean;
  };
};

class BaselineConnectionFault extends Error {
  constructor(message = "Baseline database connection fault.") {
    super(message);
    this.name = "BaselineConnectionFault";
  }
}

function isBaselineConnectionFault(error: unknown): boolean {
  if (error instanceof BaselineConnectionFault) {
    return true;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: string }).code);
    return code === "08006" || code === "57P01" || code === "ECONNRESET";
  }
  return false;
}

const BASELINE_IMPORT_ERROR_CODES = new Set([
  "IMPORT_LOCKED",
  "STALE_RUNNING_IMPORT",
  "APPLY_BLOCKED",
  "SUPERSEDED_BY_NEWER_IMPORT",
  "RECORD_COUNT_DECREASED",
  "GUID_SET_SHRINK",
  "VERIFICATION_FINGERPRINT_MISMATCH",
  "COMMIT_UNCERTAIN",
]);

function resolveBaselineApplyErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: string }).code);
    if (BASELINE_IMPORT_ERROR_CODES.has(code)) {
      return code;
    }
  }
  return "DATABASE_ERROR";
}

async function insertBaselineRun(
  client: PoolClient,
  input: {
    mode: BaselineReplacementMode;
    status: string;
    planFingerprint?: string | null;
    clientsSourceSha256?: string | null;
    rosterSourceSha256?: string | null;
    quarantineManifestSha256?: string | null;
    acceptedCompositionSha256?: string | null;
    dbBaselineSha256?: string | null;
    extendedContractConfirmationSha256?: string | null;
    planJson?: unknown;
    preApplySnapshot?: unknown;
    errorCode?: string | null;
    operatorNote?: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO onec_baseline_replacement_runs (
        mode, status, plan_fingerprint, clients_source_sha256, roster_source_sha256,
        quarantine_manifest_sha256, accepted_composition_sha256, db_baseline_sha256,
        extended_contract_confirmation_sha256, plan_json, pre_apply_status_snapshot,
        error_code, operator_note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
      RETURNING id::text
    `,
    [
      input.mode,
      input.status,
      input.planFingerprint ?? null,
      input.clientsSourceSha256 ?? null,
      input.rosterSourceSha256 ?? null,
      input.quarantineManifestSha256 ?? null,
      input.acceptedCompositionSha256 ?? null,
      input.dbBaselineSha256 ?? null,
      input.extendedContractConfirmationSha256 ?? null,
      input.planJson ? JSON.stringify(input.planJson) : null,
      input.preApplySnapshot ? JSON.stringify(input.preApplySnapshot) : null,
      input.errorCode ?? null,
      input.operatorNote ?? null,
    ],
  );
  return result.rows[0]!.id;
}

async function finishBaselineRun(
  client: PoolClient,
  runId: string,
  status: string,
  options?: { errorCode?: string | null; planJson?: unknown },
): Promise<void> {
  await client.query(
    `
      UPDATE onec_baseline_replacement_runs
      SET
        status = $2,
        finished_at = NOW(),
        error_code = COALESCE($3, error_code),
        plan_json = CASE WHEN $4::jsonb IS NOT NULL THEN $4::jsonb ELSE plan_json END
      WHERE id = $1::uuid
    `,
    [
      runId,
      status,
      options?.errorCode ?? null,
      options?.planJson ? JSON.stringify(options.planJson) : null,
    ],
  );
}

async function loadBaselineApplyResultMetaFresh(
  databaseUrl: string,
  baselineRunId: string,
): Promise<import("./baseline-replacement-db").BaselineApplyResultMeta | null> {
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    const row = await client.query<{ plan_json: unknown }>(
      `SELECT plan_json FROM onec_baseline_replacement_runs WHERE id = $1::uuid`,
      [baselineRunId],
    );
    return extractBaselineApplyResultMeta(row.rows[0]?.plan_json);
  } finally {
    client.release();
    await pool.end();
  }
}

async function assertRollbackNotSuperseded(
  client: PoolClient,
  run: { id: string; finished_at: Date | null; plan_json: unknown },
): Promise<void> {
  const finishedAt = run.finished_at ?? new Date(0);

  const newerBaseline = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM onec_baseline_replacement_runs
      WHERE mode IN ('apply', 'rollback')
        AND status = 'success'
        AND finished_at > $1
        AND id <> $2::uuid
      LIMIT 1
    `,
    [finishedAt, run.id],
  );
  if (newerBaseline.rows[0]) {
    throw Object.assign(new Error("A newer baseline replacement run exists."), {
      code: "ROLLBACK_SUPERSEDED",
    });
  }

  const meta = extractBaselineApplyResultMeta(run.plan_json);
  const newerImport = await client.query<{ id: string }>(
    meta?.clientsImportRunId
      ? `
          SELECT id::text
          FROM onec_client_import_runs
          WHERE status = 'success'
            AND finished_at > $1
            AND id <> $2::uuid
          LIMIT 1
        `
      : `
          SELECT id::text
          FROM onec_client_import_runs
          WHERE status = 'success'
            AND finished_at > $1
          LIMIT 1
        `,
    meta?.clientsImportRunId ? [finishedAt, meta.clientsImportRunId] : [finishedAt],
  );
  if (newerImport.rows[0]) {
    throw Object.assign(new Error("A newer clients import exists."), { code: "ROLLBACK_SUPERSEDED" });
  }

  if (meta) {
    const dependencyContext = await loadArchiveDependencyContext(client);
    const capture = await captureDbBaselineStateWithDependencies(client, dependencyContext);
    const digest = computeDbBaselineStateSha256(capture);
    if (digest !== meta.postApplyStateSha256) {
      throw Object.assign(new Error("Database state changed since target apply."), {
        code: "ROLLBACK_SUPERSEDED",
      });
    }
  }
}

async function hasRunningBaselineReplacement(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_baseline_replacement_runs
      WHERE status = 'running'
    `,
  );
  return Number(result.rows[0]?.count ?? "0") > 0;
}

async function buildDryRunContext(
  input: RunBaselineReplacementOptions,
  existingClient?: PoolClient,
): Promise<
  | {
      ok: false;
      code: string;
      message: string;
    }
  | {
      ok: true;
      clientsSourceSha256: string;
      rosterSourceSha256: string | null;
      holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
      payload: ValidatedClientsPayload;
      quarantineManifestSha256: string;
      acceptedGuids: Set<string>;
      quarantinedGuids: Set<string>;
      dependencyReport: import("./quarantine-validation").QuarantineDependencySample[];
      manifest: import("./quarantine-manifest").QuarantineManifest;
      existingActiveGuids: Set<string>;
      existingAllGuids: Set<string>;
      dbBaselineSha256: string;
      extendedContractStatus: "unverified" | "operator_confirmed";
      extendedContractConfirmationSha256: string | null;
      migrationReadiness: import("./baseline-replacement-preflight").MigrationReadiness;
      excludedArchiveDependencies: import("./baseline-replacement-plan").BaselineReplacementPlan["excludedArchiveDependencies"];
      acceptedProjection: import("./baseline-replacement-plan").BaselineReplacementPlan["acceptedProjection"];
    }
> {
  const manifestParsed = parseQuarantineManifestBytes(input.quarantineManifestBytes);
  if ("code" in manifestParsed) {
    return { ok: false, code: manifestParsed.code, message: manifestParsed.message };
  }

  let employeeRoster = null as import("./employee-roster").WholesaleEmployeeRoster | null;
  let rosterSourceSha256: string | null = null;
  if (input.employeeRosterBytes) {
    const rosterParse = parseWholesaleEmployeeRosterBytes(input.employeeRosterBytes);
    if (!rosterParse.ok) {
      return { ok: false, code: rosterParse.code, message: rosterParse.message };
    }
    employeeRoster = rosterParse.roster;
    rosterSourceSha256 = rosterParse.roster.sourceSha256;
  }

  const holdingLinkValidationPolicy = input.holdingLinkValidationPolicy ?? "tolerant";
  const projection = projectAcceptedClientsWithQuarantine({
    clientsBytes: input.clientsBytes,
    manifest: manifestParsed,
    limits: {
      holdingLinkValidationPolicy,
      employeeRoster,
      employeeRosterExplicit: input.employeeRosterBytes != null,
    },
  });
  if (!("payload" in projection)) {
    return { ok: false, code: projection.code, message: projection.message };
  }

  const databaseUrl = input.databaseUrl ?? getDatabaseUrl();
  if (!databaseUrl) {
    return { ok: false, code: "DATABASE_ERROR", message: "Database configuration failed." };
  }

  const ownsPool = !existingClient;
  const pool = ownsPool ? createImportPool(databaseUrl) : undefined;
  const pg = existingClient ?? (await pool!.connect());
  try {
    const readSnapshot = async () => {
      const migrationReadiness = await checkBaselineReplacementMigrationReadiness(pg);
      const hasBaselineStatus = !migrationReadiness.missing.some(
        (item) => item.description === "onec_clients.baseline_status",
      );

      let existingActiveGuids: Set<string>;
      let existingAllGuids: Set<string>;
      let dbBaselineSha256 = computeDbBaselineStateSha256({
        clients: [],
        outlets: [],
        exchange: null,
        dependencyStateSha256: null,
      });
      if (!migrationReadiness.ready) {
        existingActiveGuids = new Set();
        existingAllGuids = new Set();
      } else if (hasBaselineStatus) {
        existingActiveGuids = await loadActiveBaselineGuids(pg);
        const allRows = await pg.query<{ guid_client: string }>(`SELECT guid_client::text FROM onec_clients`);
        existingAllGuids = new Set(allRows.rows.map((row) => row.guid_client.toLowerCase()));
      } else {
        const allClients = await pg.query<{ guid_client: string }>(
          `SELECT guid_client::text FROM onec_clients`,
        );
        existingActiveGuids = new Set(allClients.rows.map((row) => row.guid_client.toLowerCase()));
        existingAllGuids = existingActiveGuids;
      }

      let dependencyContext: import("./baseline-replacement-preflight").ArchiveDependencyContext = {
        availability: "unavailable",
        unavailableDimensions: [],
        activeAccessGrantCountByClient: new Map<string, number>(),
        linkedEmployeeAccountCountByClient: new Map<string, number>(),
        confirmedOutletsByClient: new Map<string, number>(),
        bitrixTaskCountByClient: new Map<string, number>(),
        childHoldingLinkCountByClient: new Map<string, number>(),
        activeAccessGrants: [],
        employeeLinks: [],
        bitrixTaskBindings: [],
      };
      if (migrationReadiness.ready) {
        dependencyContext = await loadArchiveDependencyContext(pg);
        const dbCapture = existingClient
          ? await captureDbBaselineStateWithDependencies(pg, dependencyContext)
          : await captureDbBaselineStateConsistent(pg, dependencyContext);
        dbBaselineSha256 = computeDbBaselineStateSha256(dbCapture);
      }

      let extendedContractStatus: "unverified" | "operator_confirmed" = "unverified";
      let extendedContractConfirmationSha256: string | null = null;
      let storedConfirmationSha: string | null = null;
      if (migrationReadiness.ready) {
        storedConfirmationSha = await loadActiveExtendedContractConfirmationSha256(
          pg,
          projection.sourceSha256,
        );
      }
      const confirmation =
        input.confirmExtendedContract && input.operatorReference?.trim()
          ? buildExtendedContractConfirmation({
              clientsSourceSha256: projection.sourceSha256,
              payload: projection.payload,
              operatorReference: input.operatorReference.trim(),
            })
          : null;

      if (confirmation && migrationReadiness.ready) {
        extendedContractConfirmationSha256 = computeExtendedContractConfirmationSha256(
          confirmation,
        );
        extendedContractStatus = resolveExtendedContractVerificationForBaseline({
          payload: projection.payload,
          clientsSourceSha256: projection.sourceSha256,
          confirmation,
          storedConfirmationSha256: storedConfirmationSha,
        });
      } else if (storedConfirmationSha) {
        extendedContractConfirmationSha256 = storedConfirmationSha;
      }

      const archiveCandidates: string[] = [];
      for (const guid of existingActiveGuids) {
        if (
          !projection.quarantine.acceptedGuids.has(guid) &&
          !projection.quarantine.quarantinedGuids.has(guid)
        ) {
          archiveCandidates.push(guid);
        }
      }
      const quarantineInDb = [...projection.quarantine.quarantinedGuids].filter((guid) =>
        existingAllGuids.has(guid),
      );
      const dependencyGuids = [...archiveCandidates, ...quarantineInDb];
      const excludedArchiveDependencies = buildExcludedArchiveDependencyReport({
        guidsToArchive: dependencyGuids,
        dependencyContext,
      });

      return {
        migrationReadiness,
        existingActiveGuids,
        existingAllGuids,
        dbBaselineSha256,
        extendedContractStatus,
        extendedContractConfirmationSha256,
        excludedArchiveDependencies,
      };
    };

    const snapshotData = existingClient
      ? await readSnapshot()
      : await (async () => {
          await pg.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          try {
            const data = await readSnapshot();
            await pg.query("COMMIT");
            return data;
          } catch (error) {
            await pg.query("ROLLBACK");
            throw error;
          }
        })();

    const {
      migrationReadiness,
      existingActiveGuids,
      existingAllGuids,
      dbBaselineSha256,
      extendedContractStatus,
      extendedContractConfirmationSha256,
      excludedArchiveDependencies,
    } = snapshotData;

    return {
      ok: true,
      clientsSourceSha256: projection.sourceSha256,
      rosterSourceSha256,
      holdingLinkValidationPolicy,
      payload: projection.payload,
      quarantineManifestSha256: projection.quarantine.manifestSha256,
      acceptedGuids: projection.quarantine.acceptedGuids,
      quarantinedGuids: projection.quarantine.quarantinedGuids,
      dependencyReport: projection.quarantine.dependencyReport,
      manifest: manifestParsed,
      existingActiveGuids,
      existingAllGuids,
      dbBaselineSha256,
      extendedContractStatus,
      extendedContractConfirmationSha256,
      migrationReadiness,
      excludedArchiveDependencies,
      acceptedProjection: {
        validationOk: true,
        recordCount: projection.payload.recordCount,
        nestedOutletCount: projection.payload.extendedDiagnostics?.nestedOutletCount ?? null,
        sourceSha256: projection.sourceSha256,
      },
    };
  } finally {
    if (ownsPool) {
      pg.release();
      await pool!.end();
    }
  }
}

const discardedBaselineConnections = new WeakSet<PoolClient>();

async function discardBaselineConnection(client: PoolClient): Promise<void> {
  if (discardedBaselineConnections.has(client)) return;
  discardedBaselineConnections.add(client);
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off("end", done);
      resolve();
    };
    const timer = setTimeout(done, 2_000);
    client.once("end", done);
    try {
      // Destroy via the pool, not Client.end(): the latter leaves a checked-out
      // entry behind and pool.end() can wait forever.
      client.release(true);
    } catch {
      void client.end().then(done, done);
    }
  });
}

function sameBaselineInputs(previous: unknown, current: unknown): boolean {
  if (!previous || typeof previous !== "object" || !current || typeof current !== "object") {
    return false;
  }
  const a = previous as Record<string, unknown>;
  const b = current as Record<string, unknown>;
  for (const key of ["clientsSourceSha256", "rosterSourceSha256",
    "quarantineManifestSha256", "holdingLinkValidationPolicy"]) {
    if (a[key] !== b[key]) return false;
  }
  const ac = a.extendedContract as { confirmationSha256?: string | null } | undefined;
  const bc = b.extendedContract as { confirmationSha256?: string | null } | undefined;
  return (ac?.confirmationSha256 ?? null) === (bc?.confirmationSha256 ?? null);
}

async function releaseBaselineConnection(
  client: PoolClient,
  pool: ReturnType<typeof createImportPool> | undefined,
  faulted: boolean,
): Promise<void> {
  if (faulted || discardedBaselineConnections.has(client)) {
    await discardBaselineConnection(client);
    if (pool) {
      await pool.end();
    }
    return;
  }
  try {
    await releaseImportLock(client);
    client.release();
  } catch {
    await discardBaselineConnection(client);
    if (pool) {
      await pool.end();
    }
    return;
  }
  if (pool) {
    await pool.end();
  }
}

export async function runBaselineReplacement(
  options: RunBaselineReplacementOptions,
): Promise<BaselineReplacementResult> {
  const startedAt = Date.now();
  const mode = options.mode;

  if (mode === "rollback") {
    return runBaselineRollback(options, startedAt);
  }

  const context = await buildDryRunContext(options);
  if (!context.ok) {
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: context.code,
      message: context.message,
    };
  }

  const acceptedCompositionSha256 = computeAcceptedCompositionSha256(context.acceptedGuids);
  const incomingGuids = new Set([
    ...context.acceptedGuids,
    ...context.quarantinedGuids,
  ]);

  const fingerprint = computeBaselineReplacementFingerprint({
    clientsSha256: context.clientsSourceSha256,
    rosterSha256: context.rosterSourceSha256,
    holdingLinkValidationPolicy: context.holdingLinkValidationPolicy,
    quarantineManifestSha256: context.quarantineManifestSha256,
    acceptedCompositionSha256,
    dbBaselineSha256: context.dbBaselineSha256,
    extendedContractConfirmationSha256: context.extendedContractConfirmationSha256,
  });

  const plan = buildBaselineReplacementPlan({
    mode: mode === "apply" ? "apply" : "dry_run",
    clientsSourceSha256: context.clientsSourceSha256,
    rosterSourceSha256: context.rosterSourceSha256,
    quarantineManifestSha256: context.quarantineManifestSha256,
    holdingLinkValidationPolicy: context.holdingLinkValidationPolicy,
    acceptedGuids: context.acceptedGuids,
    quarantinedGuids: context.quarantinedGuids,
    incomingGuids,
    existingActiveGuids: context.existingActiveGuids,
    existingAllGuids: context.existingAllGuids,
    fingerprint,
    dependencyReport: context.dependencyReport,
    acceptedProjection: context.acceptedProjection,
    migrationReadiness: context.migrationReadiness,
    excludedArchiveDependencies: context.excludedArchiveDependencies,
    extendedContractStatus: context.extendedContractStatus,
    extendedContractConfirmationSha256: context.extendedContractConfirmationSha256,
    confirmExtendedContractRequested: options.confirmExtendedContract === true,
    operatorReferenceProvided: Boolean(options.operatorReference?.trim()),
  });

  if (mode === "dry_run") {
    const dryRunDatabaseUrl = options.databaseUrl ?? getDatabaseUrl();
    if (dryRunDatabaseUrl && plan.migrationReadiness.ready) {
      const dryRunPool = createImportPool(dryRunDatabaseUrl);
      const dryRunPg = await dryRunPool.connect();
      try {
        await dryRunPg.query("BEGIN");
        const dryRunRecordId = await insertBaselineRun(dryRunPg, {
          mode: "dry_run",
          status: "running",
          planFingerprint: fingerprint,
          clientsSourceSha256: context.clientsSourceSha256,
          rosterSourceSha256: context.rosterSourceSha256,
          quarantineManifestSha256: context.quarantineManifestSha256,
          acceptedCompositionSha256: acceptedCompositionSha256,
          dbBaselineSha256: context.dbBaselineSha256,
          extendedContractConfirmationSha256: context.extendedContractConfirmationSha256,
          planJson: plan,
        });
        await finishBaselineRun(dryRunPg, dryRunRecordId, "success");
        await dryRunPg.query("COMMIT");
      } catch {
        try {
          await dryRunPg.query("ROLLBACK");
        } catch {
          // ignore
        }
      } finally {
        dryRunPg.release();
        await dryRunPool.end();
      }
    }
    return {
      ok: true,
      mode,
      durationMs: Date.now() - startedAt,
      plan,
    };
  }

  const expected = options.expectedFingerprint?.trim().toLowerCase();
  if (!expected) {
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "FINGERPRINT_REQUIRED",
      message: "Apply requires --expected-fingerprint from the preceding dry-run.",
      plan,
    };
  }
  if (expected !== fingerprint.toLowerCase()) {
    const classifyDatabaseUrl = options.databaseUrl ?? getDatabaseUrl();
    let idempotentRetry = false;
    let stalePlan = false;
    if (classifyDatabaseUrl) {
      const classifyPool = createImportPool(classifyDatabaseUrl);
      const classifyPg = await classifyPool.connect();
      try {
        const priorApply = await findSuccessfulBaselineApplyByFingerprint(classifyPg, {
          planFingerprint: expected,
          clientsSourceSha256: context.clientsSourceSha256,
        });
        if (priorApply && sameBaselineInputs(priorApply.plan_json, plan)) {
          idempotentRetry = true;
        } else {
          const dryRunRecord = await findDryRunByFingerprint(classifyPg, {
            planFingerprint: expected,
            clientsSourceSha256: context.clientsSourceSha256,
          });
          stalePlan =
            dryRunRecord != null &&
            (dryRunRecord.roster_source_sha256 ?? null) === (context.rosterSourceSha256 ?? null) &&
            (dryRunRecord.quarantine_manifest_sha256 ?? null) ===
              (context.quarantineManifestSha256 ?? null);
        }
      } finally {
        classifyPg.release();
        await classifyPool.end();
      }
    }
    if (!idempotentRetry) {
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: stalePlan ? "STALE_PLAN" : "FINGERPRINT_MISMATCH",
        message: stalePlan
          ? "Database baseline or inputs changed since dry-run; re-run dry-run."
          : "Baseline replacement fingerprint mismatch since dry-run.",
        actualFingerprint: fingerprint,
        plan,
      };
    }
  }

  if (!plan.applyAllowed) {
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "APPLY_BLOCKED",
      message: `Apply blocked: ${plan.blockers.join(", ")}.`,
      plan,
    };
  }

  const databaseUrl = options.databaseUrl ?? getDatabaseUrl();
  if (!databaseUrl) {
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: "Database configuration failed.",
      plan,
    };
  }

  const pool = createImportPool(databaseUrl);
  const pg = await pool.connect();
  let baselineRunId = "";
  let connectionFaulted = false;
  try {
    if (await hasRunningBaselineReplacement(pg)) {
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: "CONCURRENT_BASELINE_REPLACEMENT",
        message: "Another baseline replacement run is already in progress.",
        plan,
      };
    }

    const lockHeld = await tryAcquireImportLock(pg);
    if (!lockHeld) {
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: "IMPORT_LOCKED",
        message: "Another clients import is already running.",
        plan,
      };
    }

    await pg.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    let commitAttempted = false;
    let commitConfirmed = false;
    try {
      const freshContext = await buildDryRunContext(options, pg);
      if (!freshContext.ok) {
        await pg.query("ROLLBACK");
        return {
          ok: false,
          mode,
          durationMs: Date.now() - startedAt,
          code: freshContext.code,
          message: freshContext.message,
          plan,
        };
      }

      const freshPlan = buildBaselineReplacementPlan({
        mode: "apply",
        clientsSourceSha256: freshContext.clientsSourceSha256,
        rosterSourceSha256: freshContext.rosterSourceSha256,
        quarantineManifestSha256: freshContext.quarantineManifestSha256,
        holdingLinkValidationPolicy: freshContext.holdingLinkValidationPolicy,
        acceptedGuids: freshContext.acceptedGuids,
        quarantinedGuids: freshContext.quarantinedGuids,
        incomingGuids: new Set([...freshContext.acceptedGuids, ...freshContext.quarantinedGuids]),
        existingActiveGuids: freshContext.existingActiveGuids,
        existingAllGuids: freshContext.existingAllGuids,
        fingerprint: expected,
        dependencyReport: freshContext.dependencyReport,
        acceptedProjection: freshContext.acceptedProjection,
        migrationReadiness: freshContext.migrationReadiness,
        excludedArchiveDependencies: freshContext.excludedArchiveDependencies,
        extendedContractStatus: freshContext.extendedContractStatus,
        extendedContractConfirmationSha256: freshContext.extendedContractConfirmationSha256,
        confirmExtendedContractRequested: options.confirmExtendedContract === true,
        operatorReferenceProvided: Boolean(options.operatorReference?.trim()),
      });
      if (!freshPlan.applyAllowed) {
        await pg.query("ROLLBACK");
        return {
          ok: false,
          mode,
          durationMs: Date.now() - startedAt,
          code: "APPLY_BLOCKED",
          message: `Apply blocked: ${freshPlan.blockers.join(", ")}.`,
          plan: freshPlan,
        };
      }

      const priorApply = await findSuccessfulBaselineApplyByFingerprint(pg, {
        planFingerprint: expected,
        clientsSourceSha256: freshContext.clientsSourceSha256,
      });
      if (priorApply && sameBaselineInputs(priorApply.plan_json, freshPlan)) {
        const priorMeta = extractBaselineApplyResultMeta(priorApply.plan_json);
        if (priorMeta) {
          const dependencyContext = await loadArchiveDependencyContext(pg);
          const currentDigest = computeDbBaselineStateSha256(
            await captureDbBaselineStateWithDependencies(pg, dependencyContext),
          );
          if (currentDigest === priorMeta.postApplyStateSha256) {
            await pg.query("ROLLBACK");
            return {
              ok: true,
              mode,
              durationMs: Date.now() - startedAt,
              plan: freshPlan,
              apply: {
                runId: priorApply.id,
                archivedCount: 0,
                quarantinedCount: 0,
                importRunId: priorMeta.clientsImportRunId,
              },
            };
          }
          await pg.query("ROLLBACK");
          return {
            ok: false,
            mode,
            durationMs: Date.now() - startedAt,
            code: "STALE_PLAN",
            message: "Post-apply database state changed since prior successful apply.",
            plan: freshPlan,
          };
        }
      }

      const freshFingerprint = computeBaselineReplacementFingerprint({
        clientsSha256: freshContext.clientsSourceSha256,
        rosterSha256: freshContext.rosterSourceSha256,
        holdingLinkValidationPolicy: freshContext.holdingLinkValidationPolicy,
        quarantineManifestSha256: freshContext.quarantineManifestSha256,
        acceptedCompositionSha256: computeAcceptedCompositionSha256(freshContext.acceptedGuids),
        dbBaselineSha256: freshContext.dbBaselineSha256,
        extendedContractConfirmationSha256: freshContext.extendedContractConfirmationSha256,
      });
      if (freshFingerprint.toLowerCase() !== expected) {
        await pg.query("ROLLBACK");
        return {
          ok: false,
          mode,
          durationMs: Date.now() - startedAt,
          code: "STALE_PLAN",
          message: "Database baseline or inputs changed since dry-run; re-run dry-run.",
          actualFingerprint: freshFingerprint,
          plan: freshPlan,
        };
      }

      const preSnapshot = await capturePreApplySnapshotV3(pg);
      baselineRunId = await insertBaselineRun(pg, {
        mode: "apply",
        status: "running",
        planFingerprint: expected,
        clientsSourceSha256: freshContext.clientsSourceSha256,
        rosterSourceSha256: freshContext.rosterSourceSha256,
        quarantineManifestSha256: freshContext.quarantineManifestSha256,
        acceptedCompositionSha256: computeAcceptedCompositionSha256(freshContext.acceptedGuids),
        dbBaselineSha256: freshContext.dbBaselineSha256,
        extendedContractConfirmationSha256: freshContext.extendedContractConfirmationSha256,
        planJson: freshPlan,
        preApplySnapshot: preSnapshot,
        operatorNote: options.operatorNote ?? null,
      });

      const applyPayload: ValidatedClientsPayload = {
        ...freshContext.payload,
        extendedContractVerification: "unverified",
      };

      if (options.confirmExtendedContract && options.operatorReference?.trim()) {
        const confirmation = buildExtendedContractConfirmation({
          clientsSourceSha256: freshContext.clientsSourceSha256,
          payload: applyPayload,
          operatorReference: options.operatorReference.trim(),
        });
        await storeExtendedContractConfirmation(pg, {
          clientsSourceSha256: freshContext.clientsSourceSha256,
          verificationFingerprint: verificationFingerprintFromPayload({ payload: applyPayload }),
          operatorReference: options.operatorReference.trim(),
          confirmationSha256: computeExtendedContractConfirmationSha256(confirmation),
        });
      }

      const importResult = await applyClientsImport({
        databaseUrl,
        payload: applyPayload,
        client: pg,
        lockAlreadyHeld: true,
        retainLock: true,
        participatingTransaction: true,
        syncExchangeState: false,
        baselineReplacementApply: true,
        originalClientsSourceSha256: freshContext.clientsSourceSha256,
        expectedVerificationFingerprint: verificationFingerprintFromPayload({ payload: applyPayload }),
        holdingLinkValidationPolicy: freshContext.holdingLinkValidationPolicy,
        employeeRosterSourceSha256: freshContext.rosterSourceSha256,
      });

      if (!importResult.ok) {
        throw Object.assign(new Error(importResult.message), { code: importResult.code });
      }
      if (!importResult.runId) {
        throw Object.assign(new Error("Import apply succeeded without run journal id."), {
          code: "DATABASE_ERROR",
        });
      }

      const archiveResult = await archiveClientsNotInAccepted(pg, {
        acceptedGuids: freshContext.acceptedGuids,
        quarantinedGuids: freshContext.quarantinedGuids,
        sourceSha256: freshContext.clientsSourceSha256,
      });

      await upsertQuarantineRecords(pg, {
        manifest: freshContext.manifest,
        supersedePrevious: true,
      });

      await updateExchangeStateAfterApplyInTxn(pg, {
        sha256: applyPayload.sha256,
        acceptedBaselineSha256: freshContext.clientsSourceSha256,
      });

      const postDependencyContext = await loadArchiveDependencyContext(pg);
      const postApplyStateSha256 = computeDbBaselineStateSha256(
        await captureDbBaselineStateWithDependencies(pg, postDependencyContext),
      );
      const finalPlanJson = {
        ...freshPlan,
        applyResult: {
          postApplyStateSha256,
          clientsImportRunId: importResult.runId,
        },
      };

      await finishBaselineRun(pg, baselineRunId, "success", { planJson: finalPlanJson });
      commitAttempted = true;
      if (options.testHooks?.failCommit) {
        throw Object.assign(new Error("Simulated commit failure."), { code: "08006" });
      }
      await pg.query("COMMIT");
      commitConfirmed = true;
      if (options.testHooks?.failAfterCommitConfirm) {
        connectionFaulted = true;
        throw new BaselineConnectionFault();
      }

      return {
        ok: true,
        mode,
        durationMs: Date.now() - startedAt,
        plan: freshPlan,
        apply: {
          runId: baselineRunId,
          archivedCount: archiveResult.archivedCount,
          quarantinedCount: archiveResult.quarantinedCount,
          importRunId: importResult.runId,
        },
      };
    } catch (error) {
      if (isBaselineConnectionFault(error)) {
        connectionFaulted = true;
      }

      if (commitConfirmed && baselineRunId) {
        const priorMeta = await loadBaselineApplyResultMetaFresh(databaseUrl, baselineRunId);
        return {
          ok: true,
          mode,
          durationMs: Date.now() - startedAt,
          plan,
          apply: {
            runId: baselineRunId,
            archivedCount: 0,
            quarantinedCount: 0,
            importRunId: priorMeta?.clientsImportRunId ?? baselineRunId,
          },
        };
      }

      if (commitAttempted && !commitConfirmed && baselineRunId) {
        connectionFaulted = true;
        try {
          await pg.query("ROLLBACK");
        } catch {
          // ignore
        }
        // A surviving session still owns its session advisory lock, even after
        // ROLLBACK. Dispose of it before fresh-connection reconciliation.
        await discardBaselineConnection(pg);
        const resolution = await resolveBaselineCommitUncertainFresh(databaseUrl, baselineRunId);
        if (resolution === "committed") {
          const priorMeta = await loadBaselineApplyResultMetaFresh(databaseUrl, baselineRunId);
          return {
            ok: true,
            mode,
            durationMs: Date.now() - startedAt,
            plan,
            apply: {
              runId: baselineRunId,
              archivedCount: 0,
              quarantinedCount: 0,
              importRunId: priorMeta?.clientsImportRunId ?? baselineRunId,
            },
          };
        }
        if (resolution === "still_uncertain") {
          return {
            ok: false,
            mode,
            durationMs: Date.now() - startedAt,
            code: "COMMIT_UNCERTAIN",
            message:
              "Baseline replacement commit outcome is unknown; inspect the baseline run journal before retrying.",
            plan,
          };
        }
        return {
          ok: false,
          mode,
          durationMs: Date.now() - startedAt,
          code: "DATABASE_ERROR",
          message: "Baseline replacement apply failed.",
          plan,
        };
      }

      try {
        await pg.query("ROLLBACK");
      } catch {
        connectionFaulted = true;
      }
      if (baselineRunId && !connectionFaulted) {
        await finishBaselineRun(pg, baselineRunId, "failed", { errorCode: "DATABASE_ERROR" });
      }
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: resolveBaselineApplyErrorCode(error),
        message: error instanceof Error ? error.message : "Baseline replacement apply failed.",
        plan,
      };
    }
  } catch (error) {
    connectionFaulted = true;
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: error instanceof Error ? error.message : "Baseline replacement apply failed.",
      plan,
    };
  } finally {
    await releaseBaselineConnection(pg, pool, connectionFaulted);
  }
}

async function runBaselineRollback(
  options: RunBaselineReplacementOptions,
  startedAt: number,
): Promise<BaselineReplacementResult> {
  const databaseUrl = options.databaseUrl ?? getDatabaseUrl();
  if (!databaseUrl) {
    return {
      ok: false,
      mode: "rollback",
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: "Database configuration failed.",
    };
  }

  const pool = createImportPool(databaseUrl);
  const pg = await pool.connect();
  let connectionFaulted = false;
  let rollbackRunId = "";
  try {
    const lockHeld = await tryAcquireImportLock(pg);
    if (!lockHeld) {
      return {
        ok: false,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        code: "IMPORT_LOCKED",
        message: "Another clients import is already running.",
      };
    }

    let commitAttempted = false;
    let commitConfirmed = false;

    await pg.query("BEGIN");
    try {
      const targetRunId = options.rollbackRunId?.trim();
      const runQuery = targetRunId
        ? await pg.query<{
            id: string;
            finished_at: Date | null;
            pre_apply_status_snapshot: unknown;
            plan_json: unknown;
          }>(
            `
              SELECT id::text, finished_at, pre_apply_status_snapshot, plan_json
              FROM onec_baseline_replacement_runs
              WHERE id = $1::uuid AND mode = 'apply' AND status = 'success'
            `,
            [targetRunId],
          )
        : await pg.query<{
            id: string;
            finished_at: Date | null;
            pre_apply_status_snapshot: unknown;
            plan_json: unknown;
          }>(
            `
              SELECT id::text, finished_at, pre_apply_status_snapshot, plan_json
              FROM onec_baseline_replacement_runs
              WHERE mode = 'apply' AND status = 'success'
              ORDER BY finished_at DESC NULLS LAST
              LIMIT 1
            `,
          );

      const run = runQuery.rows[0];
      if (!run?.pre_apply_status_snapshot || !isPreApplySnapshotV3(run.pre_apply_status_snapshot)) {
        await pg.query("ROLLBACK");
        return {
          ok: false,
          mode: "rollback",
          durationMs: Date.now() - startedAt,
          code: "ROLLBACK_UNSUPPORTED",
          message: "Rollback requires a v3 pre-apply snapshot with exchange state.",
        };
      }

      await assertRollbackNotSuperseded(pg, run);

      rollbackRunId = await insertBaselineRun(pg, {
        mode: "rollback",
        status: "running",
        operatorNote: options.operatorNote ?? null,
      });

      const restoredCount = await restorePreApplySnapshotV3(pg, run.pre_apply_status_snapshot);
      await finishBaselineRun(pg, rollbackRunId, "success");
      commitAttempted = true;
      if (options.testHooks?.failCommit) {
        throw Object.assign(new Error("Simulated rollback commit failure."), { code: "08006" });
      }
      await pg.query("COMMIT");
      commitConfirmed = true;
      if (options.testHooks?.failAfterCommitConfirm) {
        connectionFaulted = true;
        throw new BaselineConnectionFault();
      }

      return {
        ok: true,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        apply: {
          runId: rollbackRunId,
          archivedCount: 0,
          quarantinedCount: 0,
          importRunId: run.id,
          restoredCount,
        },
      };
    } catch (error) {
      if (isBaselineConnectionFault(error)) {
        connectionFaulted = true;
      }

      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: string }).code)
          : "DATABASE_ERROR";

      if (commitConfirmed && rollbackRunId) {
        return {
          ok: true,
          mode: "rollback",
          durationMs: Date.now() - startedAt,
          apply: {
            runId: rollbackRunId,
            archivedCount: 0,
            quarantinedCount: 0,
            importRunId: rollbackRunId,
          },
        };
      }

      if (commitAttempted && !commitConfirmed && rollbackRunId) {
        connectionFaulted = true;
        try {
          await pg.query("ROLLBACK");
        } catch {
          // ignore
        }
        await discardBaselineConnection(pg);
        const resolution = await resolveBaselineCommitUncertainFresh(databaseUrl, rollbackRunId);
        if (resolution === "committed") {
          return {
            ok: true,
            mode: "rollback",
            durationMs: Date.now() - startedAt,
            apply: {
              runId: rollbackRunId,
              archivedCount: 0,
              quarantinedCount: 0,
              importRunId: rollbackRunId,
            },
          };
        }
        if (resolution === "still_uncertain") {
          return {
            ok: false,
            mode: "rollback",
            durationMs: Date.now() - startedAt,
            code: "COMMIT_UNCERTAIN",
            message: "Rollback commit outcome is unknown; inspect the rollback run journal before retrying.",
          };
        }
      }

      try {
        await pg.query("ROLLBACK");
      } catch {
        connectionFaulted = true;
      }
      if (rollbackRunId && !connectionFaulted) {
        await finishBaselineRun(pg, rollbackRunId, "failed", { errorCode: "DATABASE_ERROR" });
      }
      return {
        ok: false,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        code: code === "ROLLBACK_SUPERSEDED" ? code : "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Baseline rollback failed.",
      };
    }
  } catch (error) {
    connectionFaulted = true;
    return {
      ok: false,
      mode: "rollback",
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: error instanceof Error ? error.message : "Baseline rollback failed.",
    };
  } finally {
    await releaseBaselineConnection(pg, pool, connectionFaulted);
  }
}

export function clientsFileSha256(bytes: Buffer): string {
  return sha256Hex(bytes);
}
