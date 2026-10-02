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

export type CatalogImageSyncOptions = {
  apply: boolean;
  maxFiles?: number;
  maxBytes?: number;
  maxRunMs?: number;
  maxRetries?: number;
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

const TRANSIENT_ERROR_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "EAGAIN", "ETIMEDOUT"]);

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

async function loadExistingAsset(
  client: PoolClient,
  sourcePath: string,
): Promise<{
  id: string;
  content_sha256: string | null;
  storage_path: string | null;
  status: string;
  source_byte_size: number | null;
} | null> {
  const existing = await client.query<{
    id: string;
    content_sha256: string | null;
    storage_path: string | null;
    status: string;
    source_byte_size: string | null;
  }>(
    `SELECT id::text, content_sha256, storage_path, status, source_byte_size
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
  row: { content_sha256: string | null; storage_path: string | null; status: string },
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
  row: {
    content_sha256: string | null;
    storage_path: string | null;
    status: string;
    source_byte_size: number | null;
  },
): Promise<boolean> {
  if (!(await isAssetStorageReady(row))) return false;
  const absoluteSource = await resolveSafeSourcePath(sourceDir, sourcePath);
  if (!absoluteSource) return false;
  const stat = await fs.stat(absoluteSource);
  if (row.source_byte_size !== null && stat.size !== Number(row.source_byte_size)) {
    return false;
  }
  return true;
}

async function publishAsset(
  client: PoolClient,
  input: {
    sourcePath: string;
    contentSha256: string;
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
        source_path, content_sha256, storage_path, mime_type, byte_size, width, height,
        source_byte_size, status, prepared_at, published_at, updated_at, last_error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', NOW(), NOW(), NOW(), NULL)
      ON CONFLICT (source_path) DO UPDATE SET
        content_sha256 = EXCLUDED.content_sha256,
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
      WHERE onec_catalog_image_assets.content_sha256 IS DISTINCT FROM EXCLUDED.content_sha256
         OR onec_catalog_image_assets.storage_path IS DISTINCT FROM EXCLUDED.storage_path
         OR onec_catalog_image_assets.status IS DISTINCT FROM 'ready'
    `,
    [
      input.sourcePath,
      input.contentSha256,
      input.storagePath,
      input.mimeType,
      input.byteSize,
      input.width,
      input.height,
      input.sourceByteSize,
    ],
  );

}

export async function runCatalogImageSync(
  client: PoolClient,
  options: CatalogImageSyncOptions,
): Promise<CatalogImageSyncReport> {
  const sourceDir = getCatalogImageSourceDir();
  const storageDir = getCatalogImageStorageDir();
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
  const maxRetries = parseLimit(options.maxRetries ?? process.env.CATALOG_IMAGE_SYNC_MAX_RETRIES, 2) ?? 2;
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

  if (options.apply && storageDir) {
    await ensureStorageDir(storageDir);
  }

  const assetRows =
    paths.length > 0
      ? await client.query<{
          source_path: string;
          content_sha256: string | null;
          storage_path: string | null;
          status: string;
          source_byte_size: string | null;
        }>(
          `SELECT source_path, content_sha256, storage_path, status, source_byte_size
           FROM onec_catalog_image_assets
           WHERE source_path = ANY($1::text[])`,
          [paths],
        )
      : { rows: [] };
  const assetByPath = new Map(
    assetRows.rows.map((row) => [
      row.source_path,
      {
        ...row,
        source_byte_size: row.source_byte_size === null ? null : Number(row.source_byte_size),
      },
    ]),
  );
  const readiness = await Promise.all(
    paths.map(async (sourcePath) => {
      const row = assetByPath.get(sourcePath);
      if (!row) return { sourcePath, ready: false };
      return { sourcePath, ready: await shouldSkipReadyAsset(sourceDir, sourcePath, row) };
    }),
  );
  const orderedPaths = readiness
    .sort((left, right) => {
      if (left.ready !== right.ready) return left.ready ? 1 : -1;
      return left.sourcePath.localeCompare(right.sourcePath);
    })
    .map((item) => item.sourcePath);

  for (const sourcePath of orderedPaths) {
    report.filesSeen += 1;

    if (Date.now() - startedAt >= maxRunMs) {
      report.stoppedByLimit = true;
      break;
    }
    if (report.sourceBytesRead >= maxBytes) {
      report.stoppedByLimit = true;
      break;
    }

    const existing = await loadExistingAsset(client, sourcePath);
    if (existing && (await shouldSkipReadyAsset(sourceDir, sourcePath, existing))) {
      report.filesSkipped += 1;
      continue;
    }

    if (report.filesWorked >= maxFiles) {
      report.stoppedByLimit = true;
      break;
    }

    report.filesWorked += 1;

    const absoluteSource = await resolveSafeSourcePath(sourceDir, sourcePath);
    if (!absoluteSource) {
      report.filesFailed += 1;
      report.errors.push({ sourcePath, message: "Unsafe source path." });
      continue;
    }

    const remainingBudget = maxBytes - report.sourceBytesRead;
    const readLimit = Math.min(perFileMaxBytes, remainingBudget);
    if (readLimit <= 0) {
      report.stoppedByLimit = true;
      break;
    }

    let sourceBuffer: Buffer;
    try {
      sourceBuffer = await withRetries(
        () => readBoundedFile(absoluteSource, readLimit),
        maxRetries,
        (error) => TRANSIENT_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? ""),
      );
      report.sourceBytesRead += sourceBuffer.length;
      report.bytesProcessed = report.sourceBytesRead + report.previewBytesWritten;
    } catch (error) {
      report.filesFailed += 1;
      report.errors.push({
        sourcePath,
        message: sanitizeImageSyncErrorMessage(error),
      });
      continue;
    }

    const processed = await processImageToPreview(sourceBuffer);
    if (!processed.ok) {
      report.filesFailed += 1;
      report.errors.push({ sourcePath, message: processed.message });
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

      await publishAsset(client, {
        sourcePath,
        contentSha256: processed.contentSha256,
        storagePath,
        mimeType: processed.mimeType,
        byteSize: processed.byteSize,
        width: processed.width,
        height: processed.height,
        sourceByteSize: sourceBuffer.length,
      });

      if (needsRestore) {
        report.filesRestored += 1;
      } else {
        report.filesPrepared += 1;
      }
    } catch (error) {
      report.filesFailed += 1;
      report.errors.push({
        sourcePath,
        message: sanitizeImageSyncErrorMessage(error),
      });
    }
  }

  report.queueComplete = !report.stoppedByLimit;
  return report;
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
