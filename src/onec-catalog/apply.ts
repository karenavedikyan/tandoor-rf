import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import {
  insertCatalogPricesStagingBatch,
  insertCatalogProductImagesBatch,
  insertCatalogProductPropertiesBatch,
  insertCatalogProductSectionsBatch,
  insertCatalogStockExpectedStagingBatch,
  insertCatalogStockStagingBatch,
} from "./batch-write";
import {
  blockCatalogApply,
  clearCatalogApplyBlock,
  ensureCatalogApplyBlockedFresh,
  findUnresolvedRunningCatalogImport,
  loadCatalogState,
  loadRecoveredApplySuccessFresh,
  markUnresolvedRunningImportFailed,
  parseCommitUncertainRunId,
  parseUnresolvedRunId,
  resolveCatalogCommitUncertainFresh,
  resolveCatalogCommitUncertainOutcome,
} from "./catalog-state";
import { classifyCommercialData } from "./commercial-classify";
import {
  DB_APPLY_OPERATION_TIMEOUT_MS,
  DB_CONNECT_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  IMPORT_ADVISORY_LOCK_KEY,
} from "./constants";
import { markExpectedCalendarExpiry, parseExpectedCalendar } from "./dates";
import { releaseCatalogImportLock, tryAcquireCatalogImportLock } from "./import-lock";
import type { ParsedCatalogSet, QuarantineEntry } from "./types";

export type CatalogApplyResult =
  | {
      ok: true;
      runId: string;
      versionId: string;
      coreApplied: true;
      commercialReady: false;
      distributionReady: boolean;
      quarantineCount: number;
      newProducts: number;
      changedProducts: number;
      missingFromSnapshot: number;
      cleanupWarning?: string;
    }
  | {
      ok: false;
      code:
        | "IMPORT_LOCKED"
        | "SKIPPED_UNCHANGED"
        | "RECORD_COUNT_DECREASED"
        | "PRODUCT_CODE_LOSS"
        | "DATABASE_ERROR"
        | "COMMIT_UNCERTAIN"
        | "APPLY_BLOCKED";
      message: string;
      runId?: string;
    };

export type CatalogApplyTestHooks = {
  /** Simulates connection loss before COMMIT is sent. */
  failCommit?: boolean;
  /** Simulates connection loss after COMMIT succeeded. */
  failAfterCommit?: boolean;
  failJournalUpdate?: boolean;
  failRelease?: boolean;
  /** Forces fresh-connection recovery to fail (fail-closed must still block via journal). */
  failRecovery?: boolean;
  onClientReady?: (client: PoolClient) => void;
};

export type CatalogApplyOptions = {
  triggerSource?: "manual" | "operator_job";
  readAt?: string;
  testHooks?: CatalogApplyTestHooks;
};

type PreviousProductSnapshot = {
  name: string;
  group_code: string | null;
  activity: string;
  properties: Map<string, { name: string; value: string }>;
  images: string[];
  sections: string[];
};

class CatalogConnectionFault extends Error {
  constructor() {
    super("Catalog connection fault.");
    this.name = "CatalogConnectionFault";
  }
}

type ManagedClient = {
  client: PoolClient;
  readonly faulted: () => boolean;
  removeErrorListener: () => void;
};

type ApplySuccessPayload = Omit<Extract<CatalogApplyResult, { ok: true }>, "ok">;

type ApplyPhaseState = {
  lockHeld: boolean;
  runId?: string;
  commitAttempted: boolean;
  commitConfirmed: boolean;
  versionId?: string;
  successPayload?: ApplySuccessPayload;
};

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
    throw new CatalogConnectionFault();
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

function createImportPool(databaseUrl: string): Pool {
  const pgOptions = createPgPoolOptions(databaseUrl);
  return new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
}

async function configureSession(managed: ManagedClient): Promise<void> {
  await queryManaged(managed, `SET statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`);
  await queryManaged(managed, `SET lock_timeout = ${DB_CONNECT_TIMEOUT_MS}`);
}

function buildManifestReport(data: ParsedCatalogSet, readAt?: string) {
  return {
    profile: data.profile,
    manifestSha256: data.manifest.manifestSha256,
    totalByteSize: data.manifest.totalByteSize,
    readAt: readAt ?? null,
    files: data.manifest.files.map((file) => ({
      relativePath: file.relativePath,
      byteSize: file.byteSize,
      sha256: file.sha256,
    })),
  };
}

function propertiesEqual(
  left: Map<string, { name: string; value: string }>,
  right: ParsedCatalogSet["products"][number]["properties"],
): boolean {
  if (left.size !== right.length) return false;
  for (const prop of right) {
    const existing = left.get(prop.code);
    if (!existing || existing.name !== prop.name || existing.value !== prop.value) {
      return false;
    }
  }
  return true;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function productChanged(
  previous: PreviousProductSnapshot | undefined,
  product: ParsedCatalogSet["products"][number],
): boolean {
  if (!previous) return false;
  if (
    previous.name !== product.name ||
    (previous.group_code ?? null) !== product.groupCode ||
    previous.activity !== product.activity
  ) {
    return true;
  }
  if (!propertiesEqual(previous.properties, product.properties)) return true;
  if (!arraysEqual(previous.images, product.images)) return true;
  if (!arraysEqual(previous.sections, product.sectionCodes)) return true;
  return false;
}

async function loadPreviousProductSnapshots(
  managed: ManagedClient,
  versionId: string | null,
): Promise<Map<string, PreviousProductSnapshot>> {
  const map = new Map<string, PreviousProductSnapshot>();
  if (!versionId) return map;

  const products = await queryManaged<{
    code: string;
    name: string;
    group_code: string | null;
    activity: string;
  }>(
    managed,
    `SELECT code, name, group_code, activity FROM onec_catalog_products WHERE version_id = $1::uuid`,
    [versionId],
  );
  for (const row of products.rows) {
    map.set(row.code, {
      name: row.name,
      group_code: row.group_code,
      activity: row.activity,
      properties: new Map(),
      images: [],
      sections: [],
    });
  }

  const properties = await queryManaged<{
    product_code: string;
    property_code: string;
    property_name: string;
    property_value: string;
  }>(
    managed,
    `SELECT product_code, property_code, property_name, property_value
     FROM onec_catalog_product_properties WHERE version_id = $1::uuid`,
    [versionId],
  );
  for (const row of properties.rows) {
    const product = map.get(row.product_code);
    if (!product) continue;
    product.properties.set(row.property_code, {
      name: row.property_name,
      value: row.property_value,
    });
  }

  const images = await queryManaged<{ product_code: string; image_path: string; sort_order: number }>(
    managed,
    `SELECT product_code, image_path, sort_order
     FROM onec_catalog_product_images WHERE version_id = $1::uuid
     ORDER BY product_code, sort_order`,
    [versionId],
  );
  for (const row of images.rows) {
    map.get(row.product_code)?.images.push(row.image_path);
  }

  const sections = await queryManaged<{ product_code: string; section_code: string }>(
    managed,
    `SELECT product_code, section_code FROM onec_catalog_product_sections WHERE version_id = $1::uuid`,
    [versionId],
  );
  for (const row of sections.rows) {
    map.get(row.product_code)?.sections.push(row.section_code);
  }

  return map;
}

async function insertRejectedRunJournal(
  managed: ManagedClient,
  data: ParsedCatalogSet,
  errorCode: string,
  triggerSource: "manual" | "operator_job",
  readAt?: string,
): Promise<string | undefined> {
  const report = {
    rejected: true,
    errorCode,
    manifest: buildManifestReport(data, readAt),
  };
  const runInsert = await queryManaged<{ id: string }>(
    managed,
    `
      INSERT INTO onec_catalog_import_runs
        (status, mode, trigger_source, manifest_sha256, source_byte_size, finished_at, error_code, report)
      VALUES ('failed', 'apply', $1, $2, $3, NOW(), $4, $5::jsonb)
      RETURNING id
    `,
    [triggerSource, data.manifest.manifestSha256, data.manifest.totalByteSize, errorCode, JSON.stringify(report)],
  );
  return runInsert.rows[0]?.id;
}

function successFromPayload(
  payload: ApplySuccessPayload,
  cleanupWarning?: string,
): Extract<CatalogApplyResult, { ok: true }> {
  return { ok: true, ...payload, cleanupWarning };
}

async function recoverFromCommitUncertainty(
  phase: ApplyPhaseState,
  databaseUrl: string,
  options: CatalogApplyOptions,
): Promise<CatalogApplyResult> {
  if (!phase.runId) {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message: "Catalog apply commit outcome is unknown; inspect the import run journal by runId.",
      runId: phase.runId,
    };
  }

  const blockReason = `COMMIT_UNCERTAIN for run ${phase.runId}`;
  if (options.testHooks?.failRecovery) {
    await ensureCatalogApplyBlockedFresh(databaseUrl, blockReason);
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message:
        "Catalog apply commit outcome is unknown; recovery is unavailable and further apply is blocked.",
      runId: phase.runId,
    };
  }

  try {
    const resolution = await resolveCatalogCommitUncertainFresh(databaseUrl, phase.runId);
    if (resolution === "committed") {
      if (phase.successPayload) {
        return successFromPayload(
          phase.successPayload,
          "Catalog import committed successfully but the connection failed during confirmation; outcome was verified by runId.",
        );
      }
      const recovered = await loadRecoveredApplySuccessFresh(databaseUrl, phase.runId);
      if (recovered) {
        return successFromPayload({
          runId: recovered.runId,
          versionId: recovered.versionId,
          coreApplied: true,
          commercialReady: false,
          distributionReady: recovered.distributionReady,
          quarantineCount: recovered.quarantineCount,
          newProducts: recovered.newProducts,
          changedProducts: recovered.changedProducts,
          missingFromSnapshot: 0,
        });
      }
    }
    if (resolution === "still_uncertain") {
      await ensureCatalogApplyBlockedFresh(databaseUrl, blockReason);
      return {
        ok: false,
        code: "COMMIT_UNCERTAIN",
        message:
          "Catalog apply commit outcome is unknown; further apply is blocked until resolved.",
        runId: phase.runId,
      };
    }
    return {
      ok: false,
      code: "DATABASE_ERROR",
      message: "Catalog apply failed.",
      runId: phase.runId,
    };
  } catch {
    await ensureCatalogApplyBlockedFresh(databaseUrl, blockReason);
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message:
        "Catalog apply commit outcome is unknown; recovery on a fresh connection failed.",
      runId: phase.runId,
    };
  }
}

async function gateUnresolvedRunningImport(
  managed: ManagedClient,
  databaseUrl: string,
  data: ParsedCatalogSet,
  triggerSource: "manual" | "operator_job",
  readAt: string | undefined,
): Promise<CatalogApplyResult | null> {
  let runningRunId = await findUnresolvedRunningCatalogImport(managed.client);
  if (!runningRunId) return null;

  const resolution = await resolveCatalogCommitUncertainOutcome(managed.client, runningRunId);
  if (resolution === "not_committed") {
    await markUnresolvedRunningImportFailed(managed.client, runningRunId, "DATABASE_ERROR");
    runningRunId = await findUnresolvedRunningCatalogImport(managed.client);
    if (!runningRunId) return null;
  } else if (resolution === "committed") {
    runningRunId = await findUnresolvedRunningCatalogImport(managed.client);
    if (!runningRunId) return null;
  }

  const blockReason = `UNRESOLVED_RUN for run ${runningRunId}`;
  await blockCatalogApply(managed.client, blockReason).catch(async () => {
    await ensureCatalogApplyBlockedFresh(databaseUrl, blockReason);
  });

  const rejectRunId = await insertRejectedRunJournal(
    managed,
    data,
    "STALE_RUNNING_IMPORT",
    triggerSource,
    readAt,
  );
  return {
    ok: false,
    code: "APPLY_BLOCKED",
    message: `Catalog apply blocked: unresolved import run ${runningRunId} must be verified or cleared first.`,
    runId: rejectRunId,
  };
}

export async function applyCatalogImport(
  databaseUrl: string,
  data: ParsedCatalogSet,
  options: CatalogApplyOptions = {},
): Promise<CatalogApplyResult> {
  const triggerSource = options.triggerSource ?? "manual";
  const phase: ApplyPhaseState = { lockHeld: false, commitAttempted: false, commitConfirmed: false };
  let pool: Pool | undefined;
  let managed: ManagedClient | undefined;
  let ownsPool = false;
  let ownsClient = false;

  try {
    pool = createImportPool(databaseUrl);
    ownsPool = true;
    const connected = await pool.connect();
    managed = managePoolClient(connected);
    ownsClient = true;
    options.testHooks?.onClientReady?.(managed.client);
    await configureSession(managed);

    const locked = await tryAcquireCatalogImportLock(managed.client);
    if (!locked) {
      return { ok: false, code: "IMPORT_LOCKED", message: "Another catalog import is in progress." };
    }
    phase.lockHeld = true;

    const staleRun = await gateUnresolvedRunningImport(
      managed,
      databaseUrl,
      data,
      triggerSource,
      options.readAt,
    );
    if (staleRun) return staleRun;

    const state = await loadCatalogState(managed.client);
    if (state.apply_blocked) {
      const uncertainRunId =
        parseCommitUncertainRunId(state.apply_blocked_reason) ??
        parseUnresolvedRunId(state.apply_blocked_reason);
      if (uncertainRunId) {
        const resolution = await resolveCatalogCommitUncertainOutcome(managed.client, uncertainRunId);
        if (resolution === "still_uncertain") {
          phase.runId = await insertRejectedRunJournal(
            managed,
            data,
            "APPLY_BLOCKED",
            triggerSource,
            options.readAt,
          );
          return {
            ok: false,
            code: "APPLY_BLOCKED",
            message:
              state.apply_blocked_reason ??
              "Catalog apply is blocked until the previous uncertain outcome is resolved.",
            runId: phase.runId,
          };
        }
      } else {
        phase.runId = await insertRejectedRunJournal(
          managed,
          data,
          "APPLY_BLOCKED",
          triggerSource,
          options.readAt,
        );
        return {
          ok: false,
          code: "APPLY_BLOCKED",
          message:
            state.apply_blocked_reason ?? "Catalog apply is blocked until an operator clears the block.",
          runId: phase.runId,
        };
      }
    }

    const existing = await queryManaged<{ id: string }>(
      managed,
      "SELECT id FROM onec_catalog_versions WHERE manifest_sha256 = $1 LIMIT 1",
      [data.manifest.manifestSha256],
    );
    if (existing.rows[0]?.id) {
      return {
        ok: false,
        code: "SKIPPED_UNCHANGED",
        message: "Catalog manifest already applied; no duplicate version created.",
      };
    }

    const previousVersionId = state.active_version_id;
    const previousSnapshots = await loadPreviousProductSnapshots(managed, previousVersionId);
    const previousCodes = new Set(previousSnapshots.keys());
    const incomingCodes = new Set(data.products.map((row) => row.code));

    if (previousCodes.size > 0) {
      if (data.products.length < previousCodes.size) {
        phase.runId = await insertRejectedRunJournal(
          managed,
          data,
          "RECORD_COUNT_DECREASED",
          triggerSource,
          options.readAt,
        );
        return {
          ok: false,
          code: "RECORD_COUNT_DECREASED",
          message: "Product count decreased compared to active catalog version.",
          runId: phase.runId,
        };
      }
      for (const code of previousCodes) {
        if (!incomingCodes.has(code)) {
          phase.runId = await insertRejectedRunJournal(
            managed,
            data,
            "PRODUCT_CODE_LOSS",
            triggerSource,
            options.readAt,
          );
          return {
            ok: false,
            code: "PRODUCT_CODE_LOSS",
            message: `Previously known product code missing from snapshot: ${code}.`,
            runId: phase.runId,
          };
        }
      }
    }

    const isDistribution = data.profile === "distribution";
    const commercial = isDistribution
      ? null
      : classifyCommercialData(data, options.readAt ? new Date(options.readAt) : new Date());
    const quarantineCount = commercial?.quarantineRowCount ?? 0;
    const quarantineRows: QuarantineEntry[] = commercial?.quarantineEntries ?? [];
    const distributionReady = isDistribution;

    const runInsert = await queryManaged<{ id: string }>(
      managed,
      `
        INSERT INTO onec_catalog_import_runs
          (status, mode, trigger_source, manifest_sha256, source_byte_size, import_profile)
        VALUES ('running', 'apply', $1, $2, $3, $4)
        RETURNING id
      `,
      [triggerSource, data.manifest.manifestSha256, data.manifest.totalByteSize, data.profile],
    );
    phase.runId = runInsert.rows[0]!.id;

    await queryManaged(managed, "BEGIN");
    await queryManaged(managed, `SET LOCAL statement_timeout = ${DB_APPLY_OPERATION_TIMEOUT_MS}`);

    const versionInsert = await queryManaged<{ id: string }>(
      managed,
      `
        INSERT INTO onec_catalog_versions
          (manifest_sha256, product_count, is_active, import_profile, distribution_ready)
        VALUES ($1, $2, FALSE, $3, $4)
        RETURNING id
      `,
      [data.manifest.manifestSha256, data.products.length, data.profile, distributionReady],
    );
    const versionId = versionInsert.rows[0]!.id;
    phase.versionId = versionId;

    for (const group of data.groups) {
      await queryManaged(
        managed,
        `INSERT INTO onec_catalog_groups (version_id, code, parent_code) VALUES ($1::uuid, $2, $3)`,
        [versionId, group.code, group.parentCode],
      );
    }
    for (const section of data.sections) {
      await queryManaged(
        managed,
        `INSERT INTO onec_catalog_sections (version_id, code, name, parent_code) VALUES ($1::uuid, $2, $3, $4)`,
        [versionId, section.code, section.name, section.parentCode],
      );
    }
    if (!isDistribution) {
      for (const storage of data.storages) {
        await queryManaged(
          managed,
          `INSERT INTO onec_catalog_storages (version_id, code, name, address, email, phone)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
          [versionId, storage.code, storage.name, storage.address, storage.email, storage.phone],
        );
      }
      for (const priceType of data.priceTypes) {
        await queryManaged(
          managed,
          `INSERT INTO onec_catalog_price_types (version_id, price_type_code, name) VALUES ($1::uuid, $2, $3)`,
          [versionId, priceType.priceTypeCode, priceType.name],
        );
      }
    }

    const propertyRows: Array<[string, string, string, string]> = [];
    const imageRows: Array<[string, string, number]> = [];
    const sectionRows: Array<[string, string]> = [];
    for (const product of data.products) {
      await queryManaged(
        managed,
        `INSERT INTO onec_catalog_products (version_id, code, group_code, activity, name, present_in_snapshot)
         VALUES ($1::uuid, $2, $3, $4, $5, TRUE)`,
        [versionId, product.code, product.groupCode, product.activity, product.name],
      );
      for (const [index, imagePath] of product.images.entries()) {
        imageRows.push([product.code, imagePath, index]);
      }
      for (const property of product.properties) {
        propertyRows.push([product.code, property.code, property.name, property.value]);
      }
      for (const sectionCode of product.sectionCodes) {
        sectionRows.push([product.code, sectionCode]);
      }
      await queryManaged(
        managed,
        `INSERT INTO onec_catalog_product_presence (version_id, product_code, present_in_snapshot)
         VALUES ($1::uuid, $2, TRUE)
         ON CONFLICT (version_id, product_code) DO UPDATE SET present_in_snapshot = EXCLUDED.present_in_snapshot`,
        [versionId, product.code],
      );
    }

    await insertCatalogProductPropertiesBatch(managed.client, versionId, propertyRows);
    await insertCatalogProductImagesBatch(managed.client, versionId, imageRows);
    await insertCatalogProductSectionsBatch(managed.client, versionId, sectionRows);

    if (!isDistribution && commercial) {
      const priceRows = data.prices.map((row, index) => {
        const classified = commercial.prices[index]!;
        return [
          row.priceTypeCode,
          row.productCode,
          row.priceRaw,
          classified.numeric,
          classified.quarantined,
          classified.reason,
        ] as [string, string, string, string | null, boolean, string | null];
      });
      await insertCatalogPricesStagingBatch(managed.client, versionId, priceRows);

      const stockRows = data.stock.map((row, index) => {
        const classified = commercial.stock[index]!;
        return [
          row.productCode,
          row.storageCode,
          row.quantityRaw,
          classified.numeric,
          classified.quarantined,
          classified.reason,
        ] as [string, string, string, string | null, boolean, string | null];
      });
      await insertCatalogStockStagingBatch(managed.client, versionId, stockRows);

      const stockExpectedRows = data.stockExpected.map((row, index) => {
        const classified = commercial.stockExpected[index]!;
        let expectedExpired = classified.expectedExpired;
        if (row.expectedDateRaw) {
          const parsedDate = parseExpectedCalendar(row.expectedDateRaw);
          if (parsedDate.ok) {
            expectedExpired = markExpectedCalendarExpiry(
              parsedDate,
              options.readAt ? new Date(options.readAt) : new Date(),
            ).expired;
          }
        }
        return [
          row.productCode,
          row.storageCode,
          row.quantityRaw,
          classified.numeric,
          row.expectedDateRaw,
          null,
          expectedExpired,
          row.availableRaw,
          classified.quarantined,
          classified.reason,
        ] as [string, string, string, string | null, string | null, string | null, boolean, string | null, boolean, string | null];
      });
      await insertCatalogStockExpectedStagingBatch(managed.client, versionId, stockExpectedRows);

      for (const entry of quarantineRows) {
        await queryManaged(
          managed,
          `INSERT INTO onec_catalog_quarantine (version_id, layer, reason_code, source_identifiers)
           VALUES ($1::uuid, $2, $3, $4::jsonb)`,
          [versionId, entry.layer, entry.reasonCode, JSON.stringify(entry.sourceIdentifiers)],
        );
      }
    }

    await queryManaged(managed, "UPDATE onec_catalog_versions SET is_active = FALSE WHERE is_active = TRUE");
    await queryManaged(managed, "UPDATE onec_catalog_versions SET is_active = TRUE WHERE id = $1::uuid", [
      versionId,
    ]);
    await queryManaged(
      managed,
      `
        UPDATE onec_catalog_state
        SET active_version_id = $1::uuid,
            last_successful_manifest_sha256 = $2,
            apply_blocked = FALSE,
            apply_blocked_reason = NULL,
            updated_at = NOW()
        WHERE id = 1
      `,
      [versionId, data.manifest.manifestSha256],
    );

    let newProducts = 0;
    let changedProducts = 0;
    for (const product of data.products) {
      const previous = previousSnapshots.get(product.code);
      if (!previous) {
        newProducts += 1;
        continue;
      }
      if (productChanged(previous, product)) {
        changedProducts += 1;
      }
    }

    const report = {
      manifest: buildManifestReport(data, options.readAt),
      counts: data.counts,
      quarantineCount,
      quarantineReasonCounts: data.counts.quarantineReasonCounts ?? {},
      classificationWarnings: data.classificationWarnings,
      classificationIncomplete: data.classificationIncomplete,
      commercialStatus: data.commercialStatus,
      newProducts,
      changedProducts,
      commercialReady: false,
      distributionReady,
      coreApplied: true,
    };

    phase.successPayload = {
      runId: phase.runId!,
      versionId,
      coreApplied: true,
      commercialReady: false,
      distributionReady,
      quarantineCount,
      newProducts,
      changedProducts,
      missingFromSnapshot: 0,
    };

    if (options.testHooks?.failJournalUpdate) {
      throw new CatalogConnectionFault();
    }

    await queryManaged(
      managed,
      `
        UPDATE onec_catalog_import_runs
        SET finished_at = NOW(),
            status = $2,
            core_applied = TRUE,
            commercial_ready = FALSE,
            distribution_ready = $7,
            applied_version_id = $3::uuid,
            product_count = $4,
            quarantine_count = $5,
            report = $6::jsonb
        WHERE id = $1::uuid
      `,
      [
        phase.runId,
        !isDistribution && quarantineCount > 0 ? "partial" : "success",
        versionId,
        data.products.length,
        quarantineCount,
        JSON.stringify(report),
        distributionReady,
      ],
    );

    phase.commitAttempted = true;
    if (options.testHooks?.failCommit) {
      throw new CatalogConnectionFault();
    }
    await queryManaged(managed, "COMMIT");
    phase.commitConfirmed = true;
    if (options.testHooks?.failAfterCommit) {
      throw new CatalogConnectionFault();
    }

    return successFromPayload(phase.successPayload!);
  } catch {
    if (phase.commitConfirmed && phase.successPayload) {
      return successFromPayload(
        phase.successPayload,
        "Catalog import committed successfully but cleanup failed afterward; verify the import run journal.",
      );
    }
    if (phase.commitAttempted && !phase.commitConfirmed && phase.runId) {
      if (managed && !managed.faulted()) {
        try {
          await managed.client.query("ROLLBACK");
        } catch {
          // Rollback is best-effort when commit confirmation was lost.
        }
      }
      return recoverFromCommitUncertainty(phase, databaseUrl, options);
    }

    if (managed && !managed.faulted()) {
      try {
        await managed.client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      if (phase.runId) {
        try {
          await managed.client.query(
            `
              UPDATE onec_catalog_import_runs
              SET finished_at = NOW(), status = 'failed', error_code = 'DATABASE_ERROR'
              WHERE id = $1::uuid AND status = 'running'
            `,
            [phase.runId],
          );
        } catch {
          // ignore journal failure
        }
      }
    }

    return { ok: false, code: "DATABASE_ERROR", message: "Catalog apply failed.", runId: phase.runId };
  } finally {
    const lockHeld = phase.lockHeld;
    phase.lockHeld = false;
    if (lockHeld && managed && !managed.faulted()) {
      try {
        if (options.testHooks?.failRelease) {
          throw new Error("Simulated lock release failure.");
        }
        await releaseCatalogImportLock(managed.client);
      } catch {
        // Lock cleanup is best-effort.
      }
    }
    if (managed) {
      managed.removeErrorListener();
      if (ownsClient) {
        try {
          managed.client.release(managed.faulted());
        } catch {
          // Connection already destroyed.
        }
      }
    }
    managed = undefined;
    if (ownsPool && pool) {
      await pool.end().catch(() => undefined);
      pool = undefined;
    }
  }
}

export async function clearCatalogApplyBlockForOperator(databaseUrl: string): Promise<void> {
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    await clearCatalogApplyBlock(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export function resolveCatalogDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || getDatabaseUrl();
}
