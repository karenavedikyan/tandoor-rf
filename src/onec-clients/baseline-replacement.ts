import type { PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { applyClientsImport, createImportPool } from "./apply";
import {
  archiveClientsNotInAccepted,
  loadActiveBaselineGuids,
  loadActiveExtendedContractConfirmationSha256,
  loadClientBaselineSnapshot,
  restoreBaselineSnapshot,
  storeExtendedContractConfirmation,
  upsertQuarantineRecords,
} from "./baseline-replacement-db";
import {
  computeAcceptedCompositionSha256,
  computeBaselineReplacementFingerprint,
  computeDbBaselineSha256,
} from "./baseline-replacement-fingerprint";
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

async function buildDryRunContext(input: RunBaselineReplacementOptions): Promise<
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

  const pool = createImportPool(databaseUrl);
  const pg = await pool.connect();
  try {
    const migrationReadiness = await checkBaselineReplacementMigrationReadiness(pg);
    const hasBaselineStatus = !migrationReadiness.missing.some(
      (item) => item.description === "onec_clients.baseline_status",
    );

    let existingActiveGuids: Set<string>;
    let snapshot: Map<string, string>;
    if (hasBaselineStatus) {
      existingActiveGuids = await loadActiveBaselineGuids(pg);
      snapshot = await loadClientBaselineSnapshot(pg);
    } else {
      const allClients = await pg.query<{ guid_client: string }>(
        `SELECT guid_client::text FROM onec_clients`,
      );
      existingActiveGuids = new Set(allClients.rows.map((row) => row.guid_client.toLowerCase()));
      snapshot = new Map(allClients.rows.map((row) => [row.guid_client.toLowerCase(), "active"]));
    }
    const existingAllGuids = new Set(snapshot.keys());
    const dbBaselineSha256 = computeDbBaselineSha256(existingActiveGuids);

    let extendedContractStatus: "unverified" | "operator_confirmed" = "unverified";
    let extendedContractConfirmationSha256: string | null = null;

    const storedConfirmationSha = await loadActiveExtendedContractConfirmationSha256(
      pg,
      projection.sourceSha256,
    );
    const confirmation = input.confirmExtendedContract
      ? buildExtendedContractConfirmation({
          payload: projection.payload,
          operatorReference: input.operatorReference?.trim() ?? "",
        })
      : null;

    if (confirmation && input.operatorReference?.trim()) {
      extendedContractConfirmationSha256 = computeExtendedContractConfirmationSha256(
        confirmation,
      );
      extendedContractStatus = resolveExtendedContractVerificationForBaseline({
        payload: projection.payload,
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
    const dependencyContext = await loadArchiveDependencyContext(pg);
    const excludedArchiveDependencies = buildExcludedArchiveDependencyReport({
      guidsToArchive: dependencyGuids,
      dependencyContext,
    });

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
    pg.release();
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
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "FINGERPRINT_MISMATCH",
      message: "Baseline replacement fingerprint mismatch since dry-run.",
      actualFingerprint: fingerprint,
      plan,
    };
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

    const freshContext = await buildDryRunContext(options);
    if (!freshContext.ok) {
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: freshContext.code,
        message: freshContext.message,
        plan,
      };
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
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: "STALE_PLAN",
        message: "Database baseline or inputs changed since dry-run; re-run dry-run.",
        actualFingerprint: freshFingerprint,
        plan,
      };
    }

    const preSnapshot = Object.fromEntries(await loadClientBaselineSnapshot(pg));
    baselineRunId = await insertBaselineRun(pg, {
      mode: "apply",
      status: "running",
      planFingerprint: fingerprint,
      clientsSourceSha256: context.clientsSourceSha256,
      rosterSourceSha256: context.rosterSourceSha256,
      quarantineManifestSha256: context.quarantineManifestSha256,
      acceptedCompositionSha256,
      dbBaselineSha256: context.dbBaselineSha256,
      extendedContractConfirmationSha256: context.extendedContractConfirmationSha256,
      planJson: plan,
      preApplySnapshot: preSnapshot,
      operatorNote: options.operatorNote ?? null,
    });

    const applyPayload: ValidatedClientsPayload = {
      ...freshContext.payload,
      extendedContractVerification:
        freshContext.extendedContractStatus === "operator_confirmed"
          ? "operator_confirmed"
          : "unverified",
    };

    await pg.query("BEGIN");

    if (
      options.confirmExtendedContract &&
      options.operatorReference?.trim() &&
      freshContext.extendedContractStatus !== "operator_confirmed"
    ) {
      const confirmation = buildExtendedContractConfirmation({
        payload: applyPayload,
        operatorReference: options.operatorReference.trim(),
      });
      await storeExtendedContractConfirmation(pg, {
        clientsSourceSha256: context.clientsSourceSha256,
        verificationFingerprint: verificationFingerprintFromPayload({ payload: applyPayload }),
        operatorReference: options.operatorReference.trim(),
        confirmationSha256: computeExtendedContractConfirmationSha256(confirmation),
      });
      applyPayload.extendedContractVerification = "operator_confirmed";
    }

    const importResult = await applyClientsImport({
      databaseUrl,
      payload: applyPayload,
      client: pg,
      lockAlreadyHeld: true,
      retainLock: true,
      baselineReplacementApply: true,
      expectedVerificationFingerprint: verificationFingerprintFromPayload({ payload: applyPayload }),
      holdingLinkValidationPolicy: freshContext.holdingLinkValidationPolicy,
      employeeRosterSourceSha256: freshContext.rosterSourceSha256,
    });

    if (!importResult.ok) {
      await pg.query("ROLLBACK");
      await finishBaselineRun(pg, baselineRunId, "failed", importResult.code);
      return {
        ok: false,
        mode,
        durationMs: Date.now() - startedAt,
        code: importResult.code,
        message: importResult.message,
        actualFingerprint: importResult.actualFingerprint,
        plan,
      };
    }

    const archiveResult = await archiveClientsNotInAccepted(pg, {
      acceptedGuids: freshContext.acceptedGuids,
      quarantinedGuids: freshContext.quarantinedGuids,
      sourceSha256: context.clientsSourceSha256,
    });

    await upsertQuarantineRecords(pg, {
      manifest: freshContext.manifest,
      supersedePrevious: true,
    });

    await pg.query("COMMIT");
    await finishBaselineRun(pg, baselineRunId, "success");

    return {
      ok: true,
      mode,
      durationMs: Date.now() - startedAt,
      plan,
      apply: {
        runId: baselineRunId,
        archivedCount: archiveResult.archivedCount,
        quarantinedCount: archiveResult.quarantinedCount,
        importRunId: importResult.runId,
      },
    };
  } catch {
    try {
      await pg.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    if (baselineRunId) {
      await finishBaselineRun(pg, baselineRunId, "failed", "DATABASE_ERROR");
    }
    return {
      ok: false,
      mode,
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: "Baseline replacement apply failed.",
      plan,
    };
  } finally {
    await releaseImportLock(pg);
    pg.release();
    await pool.end();
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
  try {
    const targetRunId = options.rollbackRunId?.trim();
    const runQuery = targetRunId
      ? await pg.query<{ id: string; pre_apply_status_snapshot: Record<string, string> | null }>(
          `
            SELECT id::text, pre_apply_status_snapshot
            FROM onec_baseline_replacement_runs
            WHERE id = $1::uuid AND mode = 'apply' AND status = 'success'
          `,
          [targetRunId],
        )
      : await pg.query<{ id: string; pre_apply_status_snapshot: Record<string, string> | null }>(
          `
            SELECT id::text, pre_apply_status_snapshot
            FROM onec_baseline_replacement_runs
            WHERE mode = 'apply' AND status = 'success'
            ORDER BY finished_at DESC NULLS LAST
            LIMIT 1
          `,
        );

    const run = runQuery.rows[0];
    if (!run?.pre_apply_status_snapshot) {
      return {
        ok: false,
        mode: "rollback",
        durationMs: Date.now() - startedAt,
        code: "ROLLBACK_TARGET_NOT_FOUND",
        message: "No successful baseline replacement apply with snapshot found.",
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

    const rollbackRunId = await insertBaselineRun(pg, {
      mode: "rollback",
      status: "running",
      operatorNote: options.operatorNote ?? null,
    });

    await pg.query("BEGIN");
    const restoredCount = await restoreBaselineSnapshot(pg, run.pre_apply_status_snapshot);
    await pg.query("COMMIT");
    await finishBaselineRun(pg, rollbackRunId, "success");

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
    return {
      ok: false,
      mode: "rollback",
      durationMs: Date.now() - startedAt,
      code: "DATABASE_ERROR",
      message: "Baseline rollback failed.",
    };
  } finally {
    await releaseImportLock(pg);
    pg.release();
    await pool.end();
  }
}

export function clientsFileSha256(bytes: Buffer): string {
  return sha256Hex(bytes);
}
