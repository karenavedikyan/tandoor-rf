import type { PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { applyClientsImport, createImportPool } from "./apply";
import {
  archiveClientsNotInAccepted,
  countActiveBaselineClients,
  findDryRunByFingerprint,
  findSuccessfulBaselineApplyByFingerprint,
  loadActiveBaselineGuids,
  loadActiveExtendedContractConfirmationSha256,
  storeExtendedContractConfirmation,
  upsertQuarantineRecords,
} from "./baseline-replacement-db";
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
  capturePreApplySnapshotV2,
  isPreApplySnapshotV2,
  restorePreApplySnapshotV2,
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
};

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
  errorCode?: string | null,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_baseline_replacement_runs
      SET status = $2, finished_at = NOW(), error_code = COALESCE($3, error_code)
      WHERE id = $1::uuid
    `,
    [runId, status, errorCode ?? null],
  );
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

async function releaseBaselineConnection(
  client: PoolClient,
  pool: ReturnType<typeof createImportPool> | undefined,
  faulted: boolean,
): Promise<void> {
  if (faulted) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    if (pool) {
      await pool.end();
    }
    return;
  }
  try {
    await releaseImportLock(client);
  } catch {
    // ignore
  }
  client.release();
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
        if (priorApply) {
          idempotentRetry = true;
        } else {
          const dryRunRecord = await findDryRunByFingerprint(classifyPg, {
            planFingerprint: expected,
            clientsSourceSha256: context.clientsSourceSha256,
          });
          stalePlan = dryRunRecord != null;
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
      if (priorApply) {
        const activeCount = await countActiveBaselineClients(pg);
        const expectedActive = freshContext.acceptedGuids.size;
        if (activeCount === expectedActive) {
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
              importRunId: priorApply.id,
            },
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

      const preSnapshot = await capturePreApplySnapshotV2(pg);
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

      if (
        options.confirmExtendedContract &&
        options.operatorReference?.trim() &&
        freshContext.extendedContractStatus !== "operator_confirmed"
      ) {
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

      await finishBaselineRun(pg, baselineRunId, "success");
      await pg.query("COMMIT");

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
      try {
        await pg.query("ROLLBACK");
      } catch {
        connectionFaulted = true;
      }
      if (baselineRunId && !connectionFaulted) {
        await finishBaselineRun(pg, baselineRunId, "failed", "DATABASE_ERROR");
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
    const targetRunId = options.rollbackRunId?.trim();
    const runQuery = targetRunId
      ? await pg.query<{ id: string; finished_at: Date | null; pre_apply_status_snapshot: unknown }>(
          `
            SELECT id::text, finished_at, pre_apply_status_snapshot
            FROM onec_baseline_replacement_runs
            WHERE id = $1::uuid AND mode = 'apply' AND status = 'success'
          `,
          [targetRunId],
        )
      : await pg.query<{ id: string; finished_at: Date | null; pre_apply_status_snapshot: unknown }>(
          `
            SELECT id::text, finished_at, pre_apply_status_snapshot
            FROM onec_baseline_replacement_runs
            WHERE mode = 'apply' AND status = 'success'
            ORDER BY finished_at DESC NULLS LAST
            LIMIT 1
          `,
        );

    const run = runQuery.rows[0];
    if (!run?.pre_apply_status_snapshot || !isPreApplySnapshotV2(run.pre_apply_status_snapshot)) {
      return {
        ok: false,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        code: "ROLLBACK_TARGET_NOT_FOUND",
        message: "No successful baseline replacement apply with v2 snapshot found.",
      };
    }

    const newerApply = await pg.query<{ id: string }>(
      `
        SELECT id::text
        FROM onec_baseline_replacement_runs
        WHERE mode = 'apply'
          AND status = 'success'
          AND finished_at > $1
          AND id <> $2::uuid
        LIMIT 1
      `,
      [run.finished_at, run.id],
    );
    if (newerApply.rows[0]) {
      return {
        ok: false,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        code: "ROLLBACK_SUPERSEDED",
        message: "A newer baseline replacement apply exists; rollback of older run is blocked.",
      };
    }

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

    await pg.query("BEGIN");
    rollbackRunId = await insertBaselineRun(pg, {
      mode: "rollback",
      status: "running",
      operatorNote: options.operatorNote ?? null,
    });

    const restoredCount = await restorePreApplySnapshotV2(pg, run.pre_apply_status_snapshot);
    await finishBaselineRun(pg, rollbackRunId, "success");
    await pg.query("COMMIT");

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
  } catch {
    try {
      await pg.query("ROLLBACK");
    } catch {
      connectionFaulted = true;
    }
    if (rollbackRunId && !connectionFaulted) {
      try {
        await finishBaselineRun(pg, rollbackRunId, "failed", "DATABASE_ERROR");
      } catch {
        connectionFaulted = true;
      }
    }
    return {
      ok: false,
      mode: "rollback",
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: "Baseline rollback failed.",
    };
  } finally {
    await releaseBaselineConnection(pg, pool, connectionFaulted);
  }
}

export function clientsFileSha256(bytes: Buffer): string {
  return sha256Hex(bytes);
}
