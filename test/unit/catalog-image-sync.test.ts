import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { runCatalogImageSync } from "../../src/catalog/image-sync";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function seedCatalogWithTwoImages(client: PoolClient, sourceDir: string): Promise<void> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/a.png</Картинка><Картинка>images/b.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
  <Товар Код="p2" Группа="g2" Активность="Y" Название="Product two"/>
</Товары>`;
  const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    "distribution",
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!, { profile: "distribution" });
  assert.equal(validated.ok, true);
  const applied = await applyCatalogImport(getIntegrationDatabaseUrl(), validated.data!);
  assert.equal(applied.ok, true);
  await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "images/a.png"), VALID_PNG);
  await fs.writeFile(path.join(sourceDir, "images/b.png"), VALID_PNG);
}

describe("catalog image sync queue", () => {
  let databaseUrl = "";
  let sourceDir = "";
  let storageDir = "";
  let pool: Pool;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-src-sync-"));
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-store-sync-"));
    process.env.CATALOG_IMAGE_SOURCE_DIR = sourceDir;
    process.env.CATALOG_IMAGE_STORAGE_DIR = storageDir;
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await seedCatalogWithTwoImages(client, sourceDir);
    } finally {
      client.release();
    }
  });

  after(async () => {
    delete process.env.CATALOG_IMAGE_SOURCE_DIR;
    delete process.env.CATALOG_IMAGE_STORAGE_DIR;
    await pool.end();
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("continues queue across limited runs without reprocessing verified ready files", async () => {
    const client = await pool.connect();
    try {
      const first = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(first.filesPrepared, 1);
      assert.equal(first.stoppedByLimit, true);
      assert.equal(first.queueComplete, false);

      const second = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(first.filesPrepared + second.filesPrepared, 2);

      const third = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(third.filesPrepared, 0);
      assert.equal(third.filesSkipped, 2);
      assert.equal(third.queueComplete, true);
    } finally {
      client.release();
    }
  });

  it("restores missing ready storage objects", async () => {
    const client = await pool.connect();
    try {
      const row = await client.query<{ storage_path: string; content_sha256: string }>(
        `SELECT storage_path, content_sha256 FROM onec_catalog_image_assets WHERE source_path = 'images/a.png'`,
      );
      const storagePath = row.rows[0]!.storage_path;
      const sha = row.rows[0]!.content_sha256;
      await fs.rm(storagePath, { force: true });

      const restored = await runCatalogImageSync(client, { apply: true, maxFiles: 2 });
      assert.ok(restored.filesRestored >= 1);
      const verified = await fs.readFile(storagePath);
      assert.ok(verified.length > 0);
      assert.equal(createHash("sha256").update(verified).digest("hex"), sha);
    } finally {
      client.release();
    }
  });
});
