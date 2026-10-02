import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { PoolClient } from "pg";
import {
  ensureStorageDir,
  getCatalogImageSourceDir,
  getCatalogImageStorageDir,
  getMaxImageBytes,
  processImageToPreview,
  readBoundedFile,
  readStoredImage,
  resolveSafeSourcePath,
  sanitizeImageSyncErrorMessage,
  verifyStoredPreview,
  writeImmutablePreview,
} from "./image-storage";

export type CatalogImageSyncTestHooks = {
  afterSourceRead?: (sourcePath: string) => Promise<void>;
  beforePublish?: (sourcePath: string) => Promise<void>;
};

export type CatalogImageSyncOptions = {
  apply: boolean;
  maxFiles?: number;
  maxBytes?: number;
  maxRunMs?: number;
  maxRetries?: number;
  verifyConcurrency?: number;
  testHooks?: CatalogImageSyncTestHooks;
};

export type CatalogImageSyncReport = {
  mode: "dry_run" | "apply";
  catalogVersionId: string | null;
  filesSeen: number;
  filesWorked: number;
  filesPrepared: number;
  filesSkipped: number;
  filesFailed: number;
  filesRestored: number;
  sourceBytesRead: number;
  previewBytesWritten: number;
  /** @deprecated use sourceBytesRead + previewBytesWritten */
  bytesProcessed: number;
  queueComplete: boolean;
  stoppedByLimit: boolean;
  errors: Array<{ sourcePath: string; message: string }>;
};

type AssetRow = {
  id: string;
  content_sha256: string | null;
  storage_path: string | null;
  status: string;
  source_byte_size: number | null;
  source_sha256: string | null;
};

const TRANSIENT_ERROR_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "EAGAIN", "ETIMEDOUT"]);

type SourceReadOutcome =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "budget_exhausted" }
  | { ok: false; reason: "error"; message: string };

type SkipCheckOutcome =
  | { outcome: "skip" }
  | { outcome: "continue" }
  | { outcome: "budget_exhausted" };

class SourceByteBudget {
  constructor(
    private readonly maxBytes: number,
    private readonly report: CatalogImageSyncReport,
  ) {}

  remaining(): number {
    return this.maxBytes - this.report.sourceBytesRead;
  }

  effectiveLimit(requested: number): number {
    return Math.min(requested, this.remaining());
  }

  record(bytesRead: number): void {
    recordSourceBytesRead(this.report, bytesRead);
  }
}

export function computeSourceSha256(sourceBuffer: Buffer): string {
  return createHash("sha256").update(sourceBuffer).digest("hex");
}

function recordSourceBytesRead(report: CatalogImageSyncReport, bytesRead: number): void {
  report.sourceBytesRead += bytesRead;
  report.bytesProcessed = report.sourceBytesRead + report.previewBytesWritten;
}

async function readSourceFile(
  absoluteSource: string,
  requestedLimit: number,
  budget: SourceByteBudget,
  maxRetries: number,
): Promise<SourceReadOutcome> {
  const limit = budget.effectiveLimit(requestedLimit);
  if (limit <= 0) {
    return { ok: false, reason: "budget_exhausted" };
  }

  try {
    const buffer = await withRetries(
      () => readBoundedFile(absoluteSource, limit),
      maxRetries,
      (error) => TRANSIENT_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? ""),
    );
    budget.record(buffer.length);
    return { ok: true, buffer };
  } catch (error) {
    return { ok: false, reason: "error", message: sanitizeImageSyncErrorMessage(error) };
  }
}

function parseLimit(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      attempt += 1;
      await sleep(Math.min(250 * attempt, 1000));
    }
  }
}

async function listActiveCatalogImagePaths(client: PoolClient): Promise<{
  versionId: string | null;
  paths: string[];
}> {
  const result = await client.query<{ image_path: string; version_id: string | null }>(
    `
      SELECT DISTINCT i.image_path, v.id::text AS version_id
      FROM onec_catalog_product_images i
      JOIN onec_catalog_state s ON s.id = 1
      JOIN onec_catalog_versions v ON v.id = s.active_version_id
      WHERE i.version_id = v.id AND v.is_active = TRUE
      ORDER BY i.image_path ASC
    `,
  );
  const versionId = result.rows[0]?.version_id ?? null;
  return {
    versionId,
    paths: result.rows.map((row) => row.image_path),
  };
}

async function loadExistingAsset(client: PoolClient, sourcePath: string): Promise<AssetRow | null> {
  const existing = await client.query<{
    id: string;
    content_sha256: string | null;
    storage_path: string | null;
    status: string;
    source_byte_size: string | null;
    source_sha256: string | null;
  }>(
    `SELECT id::text, content_sha256, storage_path, status, source_byte_size, source_sha256
     FROM onec_catalog_image_assets
     WHERE source_path = $1
     LIMIT 1`,
    [sourcePath],
  );
  const row = existing.rows[0];
  if (!row) return null;
  return {
    ...row,
    source_byte_size: row.source_byte_size === null ? null : Number(row.source_byte_size),
  };
}

async function isAssetStorageReady(
  row: Pick<AssetRow, "content_sha256" | "storage_path" | "status">,
): Promise<boolean> {
  if (row.status !== "ready" || !row.content_sha256 || !row.storage_path) {
    return false;
  }
  const verified = await verifyStoredPreview(row.storage_path, row.content_sha256);
  return verified.ok;
}

async function shouldSkipReadyAsset(
  sourceDir: string,
  sourcePath: string,
  row: AssetRow,
  budget: SourceByteBudget,
  maxRetries: number,
): Promise<SkipCheckOutcome> {
  if (!row.source_sha256) return { outcome: "continue" };
  if (!(await isAssetStorageReady(row))) return { outcome: "continue" };

  const absoluteSource = await resolveSafeSourcePath(sourceDir, sourcePath);
  if (!absoluteSource) return { outcome: "continue" };

  let stat;
  try {
    stat = await fs.stat(absoluteSource);
  } catch {
    return { outcome: "continue" };
  }
  if (row.source_byte_size !== null && stat.size !== Number(row.source_byte_size)) {
    return { outcome: "continue" };
  }

  const boundedLimit = Math.min(getMaxImageBytes(), stat.size);
  const readResult = await readSourceFile(absoluteSource, boundedLimit, budget, maxRetries);
  if (readResult.ok === false) {
    if (readResult.reason === "budget_exhausted") {
      return { outcome: "budget_exhausted" };
    }
    return { outcome: "continue" };
  }

  return computeSourceSha256(readResult.buffer) === row.source_sha256
    ? { outcome: "skip" }
    : { outcome: "continue" };
}

function rotatePaths(paths: string[], startPath: string | null): string[] {
  if (!startPath) return paths;
  const index = paths.indexOf(startPath);
  if (index <= 0) return paths;
  return [...paths.slice(index), ...paths.slice(0, index)];
}

async function loadSyncCursor(
  client: PoolClient,
  catalogVersionId: string,
): Promise<string | null> {
  const result = await client.query<{ next_source_path: string }>(
    `SELECT next_source_path FROM onec_catalog_image_sync_cursor WHERE catalog_version_id = $1::uuid`,
    [catalogVersionId],
  );
  return result.rows[0]?.next_source_path ?? null;
}

async function saveSyncCursor(
  client: PoolClient,
  catalogVersionId: string,
  nextSourcePath: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_catalog_image_sync_cursor (catalog_version_id, next_source_path, updated_at)
      VALUES ($1::uuid, $2, NOW())
      ON CONFLICT (catalog_version_id) DO UPDATE SET
        next_source_path = EXCLUDED.next_source_path,
        updated_at = NOW()
    `,
    [catalogVersionId, nextSourcePath],
  );
}

async function recordQueueOutcome(
  client: PoolClient,
  catalogVersionId: string,
  sourcePath: string,
  outcome: "ready" | "failed" | "skipped",
  errorMessage: string | null,
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_catalog_image_sync_queue (
        catalog_version_id, source_path, last_outcome, last_error, attempt_count, last_attempt_at, updated_at
      )
      VALUES ($1::uuid, $2, $3, $4, 1, NOW(), NOW())
      ON CONFLICT (catalog_version_id, source_path) DO UPDATE SET
        last_outcome = EXCLUDED.last_outcome,
        last_error = EXCLUDED.last_error,
        attempt_count = onec_catalog_image_sync_queue.attempt_count + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    `,
    [catalogVersionId, sourcePath, outcome, errorMessage],
  );
}

function nextPathInOrder(sortedPaths: string[], currentPath: string): string {
  const index = sortedPaths.indexOf(currentPath);
  if (index < 0) return sortedPaths[0] ?? currentPath;
  return sortedPaths[(index + 1) % sortedPaths.length] ?? currentPath;
}

async function isStalePublication(
  client: PoolClient,
  sourceDir: string,
  input: { sourcePath: string; sourceSha256: string },
  budget: SourceByteBudget,
  maxRetries: number,
): Promise<"fresh" | "stale" | "budget_exhausted"> {
  const existing = await loadExistingAsset(client, input.sourcePath);
  if (!existing?.source_sha256 || existing.source_sha256 === input.sourceSha256) {
    return "fresh";
  }

  const absoluteSource = await resolveSafeSourcePath(sourceDir, input.sourcePath);
  if (!absoluteSource) return "stale";

  let stat;
  try {
    stat = await fs.stat(absoluteSource);
  } catch {
    return "stale";
  }

  const readResult = await readSourceFile(
    absoluteSource,
    Math.min(stat.size, getMaxImageBytes()),
    budget,
    maxRetries,
  );
  if (readResult.ok === false) {
    if (readResult.reason === "budget_exhausted") {
      return "budget_exhausted";
    }
    return "stale";
  }

  return computeSourceSha256(readResult.buffer) === input.sourceSha256 ? "fresh" : "stale";
}

async function publishAsset(
  client: PoolClient,
  input: {
    sourcePath: string;
    contentSha256: string;
    sourceSha256: string;
    storagePath: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    sourceByteSize: number;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO onec_catalog_image_assets (
        source_path, content_sha256, source_sha256, storage_path, mime_type, byte_size, width, height,
        source_byte_size, status, prepared_at, published_at, updated_at, last_error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', NOW(), NOW(), NOW(), NULL)
      ON CONFLICT (source_path) DO UPDATE SET
        content_sha256 = EXCLUDED.content_sha256,
        source_sha256 = EXCLUDED.source_sha256,
        storage_path = EXCLUDED.storage_path,
        mime_type = EXCLUDED.mime_type,
        byte_size = EXCLUDED.byte_size,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        source_byte_size = EXCLUDED.source_byte_size,
        status = 'ready',
        prepared_at = NOW(),
        published_at = NOW(),
        updated_at = NOW(),
        last_error = NULL
    `,
    [
      input.sourcePath,
      input.contentSha256,
      input.sourceSha256,
      input.storagePath,
      input.mimeType,
      input.byteSize,
      input.width,
      input.height,
      input.sourceByteSize,
    ],
  );
}

async function publishAssetUnderLock(
  client: PoolClient,
  sourceDir: string,
  input: Parameters<typeof publishAsset>[1],
  budget: SourceByteBudget,
  maxRetries: number,
  testHooks?: CatalogImageSyncTestHooks,
): Promise<"published" | "superseded" | "budget_exhausted"> {
  if (testHooks?.beforePublish) {
    await testHooks.beforePublish(input.sourcePath);
  }
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.sourcePath]);
    const staleCheck = await isStalePublication(client, sourceDir, input, budget, maxRetries);
    if (staleCheck === "budget_exhausted") {
      await client.query("ROLLBACK");
      return "budget_exhausted";
    }
    if (staleCheck === "stale") {
      await client.query("ROLLBACK");
      return "superseded";
    }
    await publishAsset(client, input);
    await client.query("COMMIT");
    return "published";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runCatalogImageSync(
  client: PoolClient,
  options: CatalogImageSyncOptions,
): Promise<CatalogImageSyncReport> {
  const report: CatalogImageSyncReport = {
    mode: options.apply ? "apply" : "dry_run",
    catalogVersionId: null,
    filesSeen: 0,
    filesWorked: 0,
    filesPrepared: 0,
    filesSkipped: 0,
    filesFailed: 0,
    filesRestored: 0,
    sourceBytesRead: 0,
    previewBytesWritten: 0,
    bytesProcessed: 0,
    queueComplete: false,
    stoppedByLimit: false,
    errors: [],
  };

  try {
    const sourceDir = getCatalogImageSourceDir();
    const storageDir = getCatalogImageStorageDir();

    const maxFiles = parseLimit(
      options.maxFiles ?? process.env.CATALOG_IMAGE_SYNC_MAX_FILES,
      500,
    );
    const maxBytes = parseLimit(
      options.maxBytes ?? process.env.CATALOG_IMAGE_SYNC_MAX_BYTES,
      256 * 1024 * 1024,
    );
    const maxRunMs = parseLimit(
      options.maxRunMs ?? process.env.CATALOG_IMAGE_SYNC_MAX_RUN_MS,
      30 * 60 * 1000,
    );
    const maxRetries =
      parseLimit(options.maxRetries ?? process.env.CATALOG_IMAGE_SYNC_MAX_RETRIES, 2) ?? 2;
    const verifyConcurrency =
      parseLimit(
        options.verifyConcurrency ?? process.env.CATALOG_IMAGE_SYNC_VERIFY_CONCURRENCY,
        4,
      ) ?? 4;
    const perFileMaxBytes = getMaxImageBytes();
    const startedAt = Date.now();

    if (maxFiles === null || maxBytes === null || maxRunMs === null) {
      report.errors.push({ sourcePath: "*", message: "Invalid sync limits." });
      return report;
    }

    if (!sourceDir) {
      report.errors.push({ sourcePath: "*", message: "CATALOG_IMAGE_SOURCE_DIR is not configured." });
      return report;
    }
    if (options.apply && !storageDir) {
      report.errors.push({ sourcePath: "*", message: "CATALOG_IMAGE_STORAGE_DIR is not configured." });
      return report;
    }

    const { versionId, paths } = await listActiveCatalogImagePaths(client);
    report.catalogVersionId = versionId;
    const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));

    if (options.apply && storageDir) {
      await ensureStorageDir(storageDir);
    }

    if (!versionId || !sortedPaths.length) {
      report.queueComplete = true;
      return report;
    }

    const cursor = await loadSyncCursor(client, versionId);
    const orderedPaths = rotatePaths(sortedPaths, cursor);

    const assetRows =
      sortedPaths.length > 0
        ? await client.query<{
            source_path: string;
            id: string;
            content_sha256: string | null;
            storage_path: string | null;
            status: string;
            source_byte_size: string | null;
            source_sha256: string | null;
          }>(
            `SELECT source_path, id::text AS id, content_sha256, storage_path, status, source_byte_size, source_sha256
             FROM onec_catalog_image_assets
             WHERE source_path = ANY($1::text[])`,
            [sortedPaths],
          )
        : { rows: [] };

    const assetByPath = new Map<string, AssetRow>(
      assetRows.rows.map((row) => [
        row.source_path,
        {
          id: row.id,
          content_sha256: row.content_sha256,
          storage_path: row.storage_path,
          status: row.status,
          source_byte_size: row.source_byte_size === null ? null : Number(row.source_byte_size),
          source_sha256: row.source_sha256,
        },
      ]),
    );

    let verifyOps = 0;
    const maxVerifyOps = Math.max(maxFiles * 4, verifyConcurrency);
    const sourceBudget = new SourceByteBudget(maxBytes, report);
    const persistQueue = options.apply;

    for (const sourcePath of orderedPaths) {
      report.filesSeen += 1;

      if (Date.now() - startedAt >= maxRunMs) {
        report.stoppedByLimit = true;
        if (persistQueue) {
          await saveSyncCursor(client, versionId, sourcePath);
        }
        break;
      }
      if (sourceBudget.remaining() <= 0) {
        report.stoppedByLimit = true;
        if (persistQueue) {
          await saveSyncCursor(client, versionId, sourcePath);
        }
        break;
      }

      const existing = assetByPath.get(sourcePath) ?? (await loadExistingAsset(client, sourcePath));
      if (existing && verifyOps < maxVerifyOps) {
        verifyOps += 1;
        const skipCheck = await shouldSkipReadyAsset(
          sourceDir,
          sourcePath,
          existing,
          sourceBudget,
          maxRetries,
        );
        if (skipCheck.outcome === "budget_exhausted") {
          report.stoppedByLimit = true;
          if (persistQueue) {
            await saveSyncCursor(client, versionId, sourcePath);
          }
          break;
        }
        if (skipCheck.outcome === "skip") {
          report.filesSkipped += 1;
          if (persistQueue) {
            await recordQueueOutcome(client, versionId, sourcePath, "skipped", null);
            await saveSyncCursor(client, versionId, nextPathInOrder(sortedPaths, sourcePath));
          }
          continue;
        }
      }

      if (report.filesWorked >= maxFiles) {
        report.stoppedByLimit = true;
        if (persistQueue) {
          await saveSyncCursor(client, versionId, sourcePath);
        }
        break;
      }

      const absoluteSource = await resolveSafeSourcePath(sourceDir, sourcePath);
      if (!absoluteSource) {
        report.filesFailed += 1;
        report.errors.push({ sourcePath, message: "Unsafe or missing source path." });
        if (persistQueue) {
          await recordQueueOutcome(client, versionId, sourcePath, "failed", "Unsafe or missing source path.");
          await saveSyncCursor(client, versionId, nextPathInOrder(sortedPaths, sourcePath));
        }
        continue;
      }

      const readResult = await readSourceFile(absoluteSource, perFileMaxBytes, sourceBudget, maxRetries);
      if (readResult.ok === false) {
        if (readResult.reason === "budget_exhausted") {
          report.stoppedByLimit = true;
          if (persistQueue) {
            await saveSyncCursor(client, versionId, sourcePath);
          }
          break;
        }
        report.filesFailed += 1;
        report.errors.push({ sourcePath, message: readResult.message });
        if (persistQueue) {
          await recordQueueOutcome(client, versionId, sourcePath, "failed", readResult.message);
          await saveSyncCursor(client, versionId, nextPathInOrder(sortedPaths, sourcePath));
        }
        continue;
      }

      const sourceBuffer = readResult.buffer;
      report.filesWorked += 1;

      if (options.testHooks?.afterSourceRead) {
        await options.testHooks.afterSourceRead(sourcePath);
      }

      const sourceSha256 = computeSourceSha256(sourceBuffer);
      const processed = await processImageToPreview(sourceBuffer);
      if (!processed.ok) {
        report.filesFailed += 1;
        report.errors.push({ sourcePath, message: processed.message });
        if (persistQueue) {
          await recordQueueOutcome(client, versionId, sourcePath, "failed", processed.message);
          await saveSyncCursor(client, versionId, nextPathInOrder(sortedPaths, sourcePath));
        }
        continue;
      }

      const needsRestore =
        existing?.status === "ready" &&
        existing.content_sha256 === processed.contentSha256 &&
        existing.storage_path &&
        !(await verifyStoredPreview(existing.storage_path, processed.contentSha256)).ok;

      if (!options.apply) {
        report.filesPrepared += 1;
        continue;
      }

      try {
        const storagePath = await withRetries(
          () =>
            writeImmutablePreview(storageDir!, processed.contentSha256, processed.previewBuffer),
          maxRetries,
          (error) => TRANSIENT_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? ""),
        );
        report.previewBytesWritten += processed.byteSize;
        report.bytesProcessed = report.sourceBytesRead + report.previewBytesWritten;

        const publishResult = await publishAssetUnderLock(
          client,
          sourceDir,
          {
            sourcePath,
            contentSha256: processed.contentSha256,
            sourceSha256,
            storagePath,
            mimeType: processed.mimeType,
            byteSize: processed.byteSize,
            width: processed.width,
            height: processed.height,
            sourceByteSize: sourceBuffer.length,
          },
          sourceBudget,
          maxRetries,
          options.testHooks,
        );

        if (publishResult === "budget_exhausted") {
          report.stoppedByLimit = true;
          await saveSyncCursor(client, versionId, sourcePath);
          break;
        }
        if (publishResult === "superseded") {
          report.filesSkipped += 1;
          await recordQueueOutcome(
            client,
            versionId,
            sourcePath,
            "skipped",
            "Superseded by newer publication.",
          );
        } else if (needsRestore) {
          report.filesRestored += 1;
          await recordQueueOutcome(client, versionId, sourcePath, "ready", null);
        } else {
          report.filesPrepared += 1;
          await recordQueueOutcome(client, versionId, sourcePath, "ready", null);
        }
      } catch (error) {
        report.filesFailed += 1;
        const message = sanitizeImageSyncErrorMessage(error);
        report.errors.push({ sourcePath, message });
        await recordQueueOutcome(client, versionId, sourcePath, "failed", message);
      }

      await saveSyncCursor(client, versionId, nextPathInOrder(sortedPaths, sourcePath));
    }

    report.queueComplete = !report.stoppedByLimit;
    return report;
  } catch (error) {
    report.errors.push({
      sourcePath: "*",
      message: sanitizeImageSyncErrorMessage(error),
    });
    return report;
  }
}

export async function loadReadyImageAsset(
  client: PoolClient,
  assetId: string,
): Promise<{ storagePath: string; mimeType: string; contentSha256: string } | null> {
  const result = await client.query<{
    storage_path: string;
    mime_type: string;
    source_path: string;
    content_sha256: string | null;
  }>(
    `
      SELECT a.storage_path, a.mime_type, a.source_path, a.content_sha256
      FROM onec_catalog_image_assets a
      WHERE a.id = $1::uuid AND a.status = 'ready'
      LIMIT 1
    `,
    [assetId],
  );
  const row = result.rows[0];
  if (!row?.storage_path || !row.content_sha256) return null;

  const allowed = await client.query<{ ok: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM onec_catalog_product_images i
        JOIN onec_catalog_state s ON s.id = 1
        JOIN onec_catalog_versions v ON v.id = s.active_version_id
        WHERE i.version_id = v.id
          AND v.is_active = TRUE
          AND i.image_path = $1
      ) AS ok
    `,
    [row.source_path],
  );
  if (!allowed.rows[0]?.ok) return null;

  const verified = await verifyStoredPreview(row.storage_path, row.content_sha256);
  if (!verified.ok) return null;

  return {
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    contentSha256: row.content_sha256,
  };
}

export async function readReadyImageAssetBytes(
  client: PoolClient,
  assetId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const asset = await loadReadyImageAsset(client, assetId);
  if (!asset) return null;
  const storageDir = getCatalogImageStorageDir();
  try {
    const buffer = await readStoredImage(asset.storagePath, storageDir ?? undefined);
    return { buffer, mimeType: asset.mimeType };
  } catch {
    return null;
  }
}
