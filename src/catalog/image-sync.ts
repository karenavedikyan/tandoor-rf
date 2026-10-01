import type { PoolClient } from "pg";
import {
  ensureStorageDir,
  getCatalogImageSourceDir,
  getCatalogImageStorageDir,
  processImageToPreview,
  readBoundedFile,
  readStoredImage,
  resolveSafeSourcePath,
  writeImmutablePreview,
} from "./image-storage";

export type CatalogImageSyncOptions = {
  apply: boolean;
  maxFiles?: number;
  maxBytes?: number;
};

export type CatalogImageSyncReport = {
  mode: "dry_run" | "apply";
  filesSeen: number;
  filesPrepared: number;
  filesSkipped: number;
  filesFailed: number;
  bytesProcessed: number;
  errors: Array<{ sourcePath: string; message: string }>;
};

async function listActiveCatalogImagePaths(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ image_path: string }>(
    `
      SELECT DISTINCT i.image_path
      FROM onec_catalog_product_images i
      JOIN onec_catalog_state s ON s.id = 1
      JOIN onec_catalog_versions v ON v.id = s.active_version_id
      WHERE i.version_id = v.id AND v.is_active = TRUE
      ORDER BY i.image_path ASC
    `,
  );
  return result.rows.map((row) => row.image_path);
}

export async function runCatalogImageSync(
  client: PoolClient,
  options: CatalogImageSyncOptions,
): Promise<CatalogImageSyncReport> {
  const sourceDir = getCatalogImageSourceDir();
  const storageDir = getCatalogImageStorageDir();
  const report: CatalogImageSyncReport = {
    mode: options.apply ? "apply" : "dry_run",
    filesSeen: 0,
    filesPrepared: 0,
    filesSkipped: 0,
    filesFailed: 0,
    bytesProcessed: 0,
    errors: [],
  };

  if (!sourceDir) {
    report.errors.push({ sourcePath: "*", message: "CATALOG_IMAGE_SOURCE_DIR is not configured." });
    return report;
  }
  if (options.apply && !storageDir) {
    report.errors.push({ sourcePath: "*", message: "CATALOG_IMAGE_STORAGE_DIR is not configured." });
    return report;
  }

  const paths = await listActiveCatalogImagePaths(client);
  const maxFiles = options.maxFiles ?? Number(process.env.CATALOG_IMAGE_SYNC_MAX_FILES ?? "500");
  const maxBytes = options.maxBytes ?? Number(process.env.CATALOG_IMAGE_SYNC_MAX_BYTES ?? String(256 * 1024 * 1024));

  if (options.apply && storageDir) {
    await ensureStorageDir(storageDir);
  }

  for (const sourcePath of paths) {
    if (report.filesSeen >= maxFiles) break;
    if (report.bytesProcessed >= maxBytes) break;
    report.filesSeen += 1;

    const absoluteSource = await resolveSafeSourcePath(sourceDir, sourcePath);
    if (!absoluteSource) {
      report.filesFailed += 1;
      report.errors.push({ sourcePath, message: "Unsafe source path." });
      continue;
    }

    let sourceBuffer: Buffer;
    try {
      sourceBuffer = await readBoundedFile(absoluteSource, maxBytes);
    } catch (error) {
      report.filesFailed += 1;
      report.errors.push({
        sourcePath,
        message: error instanceof Error ? error.message : "Source file not readable.",
      });
      continue;
    }

    const processed = await processImageToPreview(sourceBuffer);
    if (!processed.ok) {
      report.filesFailed += 1;
      report.errors.push({ sourcePath, message: processed.message });
      continue;
    }

    report.bytesProcessed += processed.byteSize;

    const existing = await client.query<{
      id: string;
      content_sha256: string | null;
      status: string;
    }>(
      `SELECT id::text, content_sha256, status FROM onec_catalog_image_assets WHERE source_path = $1 LIMIT 1`,
      [sourcePath],
    );
    const row = existing.rows[0];
    if (row?.status === "ready" && row.content_sha256 === processed.contentSha256) {
      report.filesSkipped += 1;
      continue;
    }

    if (!options.apply) {
      report.filesPrepared += 1;
      continue;
    }

    try {
      const storagePath = await writeImmutablePreview(
        storageDir!,
        processed.contentSha256,
        processed.previewBuffer,
      );
      await client.query(
        `
          INSERT INTO onec_catalog_image_assets (
            source_path, content_sha256, storage_path, mime_type, byte_size, width, height,
            status, prepared_at, published_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', NOW(), NOW(), NOW())
          ON CONFLICT (source_path) DO UPDATE SET
            content_sha256 = EXCLUDED.content_sha256,
            storage_path = EXCLUDED.storage_path,
            mime_type = EXCLUDED.mime_type,
            byte_size = EXCLUDED.byte_size,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            status = 'ready',
            prepared_at = NOW(),
            published_at = NOW(),
            updated_at = NOW(),
            last_error = NULL
          WHERE onec_catalog_image_assets.content_sha256 IS DISTINCT FROM EXCLUDED.content_sha256
             OR onec_catalog_image_assets.storage_path IS DISTINCT FROM EXCLUDED.storage_path
        `,
        [
          sourcePath,
          processed.contentSha256,
          storagePath,
          processed.mimeType,
          processed.byteSize,
          processed.width,
          processed.height,
        ],
      );
      report.filesPrepared += 1;
    } catch (error) {
      report.filesFailed += 1;
      report.errors.push({
        sourcePath,
        message: error instanceof Error ? error.message : "Failed to publish image asset.",
      });
    }
  }

  return report;
}

export async function loadReadyImageAsset(
  client: PoolClient,
  assetId: string,
): Promise<{ storagePath: string; mimeType: string } | null> {
  const result = await client.query<{ storage_path: string; mime_type: string; source_path: string }>(
    `
      SELECT a.storage_path, a.mime_type, a.source_path
      FROM onec_catalog_image_assets a
      WHERE a.id = $1::uuid AND a.status = 'ready'
      LIMIT 1
    `,
    [assetId],
  );
  const row = result.rows[0];
  if (!row?.storage_path) return null;

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

  return { storagePath: row.storage_path, mimeType: row.mime_type };
}

export async function readReadyImageAssetBytes(
  client: PoolClient,
  assetId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const asset = await loadReadyImageAsset(client, assetId);
  if (!asset) return null;
  const buffer = await readStoredImage(asset.storagePath);
  return { buffer, mimeType: asset.mimeType };
}
