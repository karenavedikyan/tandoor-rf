import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { processImageToPreview } from "../../src/catalog/image-storage";
import { computeSourceSha256, runCatalogImageSync } from "../../src/catalog/image-sync";
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

async function buildSameSizeColorPair(): Promise<{ red: Buffer; blue: Buffer }> {
  const red = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const blue = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();

  assert.equal(red.length, blue.length);
  assert.notDeepEqual(red, blue);

  const redPreview = await processImageToPreview(red);
  const bluePreview = await processImageToPreview(blue);
  assert.equal(redPreview.ok, true);
  assert.equal(bluePreview.ok, true);
  assert.notEqual(
    redPreview.ok && bluePreview.ok ? redPreview.contentSha256 : "",
    bluePreview.ok ? bluePreview.contentSha256 : "",
  );

  return { red, blue };
}

let RED_PNG = Buffer.alloc(0);
let BLUE_PNG = Buffer.alloc(0);

async function countStorageFiles(storageRoot: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        count += 1;
      }
    }
  }
  try {
    await walk(storageRoot);
  } catch {
    return 0;
  }
  return count;
}

async function snapshotQueueState(
  client: PoolClient,
  versionId: string,
  storageRoot: string,
) {
  const assets = await client.query(
    `SELECT source_path, status, source_sha256 FROM onec_catalog_image_assets ORDER BY source_path`,
  );
  const cursor = await client.query(
    `SELECT next_source_path FROM onec_catalog_image_sync_cursor WHERE catalog_version_id = $1::uuid`,
    [versionId],
  );
  const queue = await client.query(
    `SELECT source_path, last_outcome FROM onec_catalog_image_sync_queue WHERE catalog_version_id = $1::uuid ORDER BY source_path`,
    [versionId],
  );
  const storageCount = await countStorageFiles(storageRoot);
  return {
    assets: assets.rows,
    cursor: cursor.rows[0]?.next_source_path ?? null,
    queue: queue.rows,
    storageCount,
  };
}

async function applyDistributionXml(
  databaseUrl: string,
  productsXml: string,
): Promise<{ versionId: string }> {
  const xmlSet = buildMinimalDistributionXmlSet();
  xmlSet["catalog/products/data.xml"] = productsXml;
  const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    "distribution",
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!, { profile: "distribution" });
  assert.equal(validated.ok, true);
  const applied = await applyCatalogImport(databaseUrl, validated.data!);
  assert.equal(applied.ok, true);
  return { versionId: applied.versionId };
}

describe("client catalog image sync integration", { concurrency: false }, () => {
  let databaseUrl = "";
  let sourceDir = "";
  let storageDir = "";
  let pool: Pool;

  before(async () => {
    const pair = await buildSameSizeColorPair();
    RED_PNG = pair.red;
    BLUE_PNG = pair.blue;

    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-src-sync-"));
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-store-sync-"));
    process.env.CATALOG_IMAGE_SOURCE_DIR = sourceDir;
    process.env.CATALOG_IMAGE_STORAGE_DIR = storageDir;
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  after(async () => {
    delete process.env.CATALOG_IMAGE_SOURCE_DIR;
    delete process.env.CATALOG_IMAGE_STORAGE_DIR;
    await pool.end();
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("updates publication when same-size source content changes", async () => {
    assert.equal(RED_PNG.length, BLUE_PNG.length);
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/color.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    const imagePath = path.join(sourceDir, "images/color.png");
    await fs.writeFile(imagePath, RED_PNG);

    const client = await pool.connect();
    try {
      const first = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(first.filesPrepared, 1);

      const firstRow = await client.query<{ source_sha256: string; content_sha256: string }>(
        `SELECT source_sha256, content_sha256 FROM onec_catalog_image_assets WHERE source_path = 'images/color.png'`,
      );
      const firstSourceSha = firstRow.rows[0]!.source_sha256;
      const firstPreviewSha = firstRow.rows[0]!.content_sha256;
      assert.equal(firstSourceSha, computeSourceSha256(RED_PNG));

      await fs.writeFile(imagePath, BLUE_PNG);
      const second = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(second.filesSkipped, 0);
      assert.equal(second.filesPrepared, 1);

      const secondRow = await client.query<{ source_sha256: string; content_sha256: string }>(
        `SELECT source_sha256, content_sha256 FROM onec_catalog_image_assets WHERE source_path = 'images/color.png'`,
      );
      assert.equal(secondRow.rows[0]!.source_sha256, computeSourceSha256(BLUE_PNG));
      assert.notEqual(secondRow.rows[0]!.source_sha256, firstSourceSha);
      assert.notEqual(secondRow.rows[0]!.content_sha256, firstPreviewSha);
    } finally {
      client.release();
    }
  });

  it("does not let a missing leading path block later files within maxFiles", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/0-missing.png</Картинка><Картинка>images/b.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/b.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const report = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(report.filesFailed, 1);
      assert.equal(report.filesPrepared, 1);
      const row = await client.query<{ source_path: string }>(
        `SELECT source_path FROM onec_catalog_image_assets WHERE status = 'ready'`,
      );
      assert.deepEqual(row.rows.map((item) => item.source_path), ["images/b.png"]);
    } finally {
      client.release();
    }
  });

  it("continues queue across limited runs and restores previously missing files", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/a.png</Картинка><Картинка>images/b.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/a.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const first = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(first.filesPrepared, 1);
      assert.equal(first.stoppedByLimit, true);

      await fs.writeFile(path.join(sourceDir, "images/b.png"), VALID_PNG);
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

  it("does not let a delayed apply overwrite a newer publication", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/race.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    const imagePath = path.join(sourceDir, "images/race.png");
    await fs.writeFile(imagePath, RED_PNG);

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    let releaseSourceRead: (() => void) | null = null;
    let releasePublish: (() => void) | null = null;
    const sourceWasRead = new Promise<void>((resolve) => {
      releaseSourceRead = resolve;
    });
    const mayPublish = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });

    try {
      const slow = runCatalogImageSync(clientA, {
        apply: true,
        maxFiles: 1,
        testHooks: {
          afterSourceRead: async () => {
            releaseSourceRead!();
            await mayPublish;
          },
        },
      });

      await sourceWasRead;
      await fs.writeFile(imagePath, BLUE_PNG);
      const fast = await runCatalogImageSync(clientB, { apply: true, maxFiles: 1 });
      assert.equal(fast.filesPrepared, 1);

      const afterFast = await clientB.query<{ source_sha256: string }>(
        `SELECT source_sha256 FROM onec_catalog_image_assets WHERE source_path = 'images/race.png'`,
      );
      assert.equal(afterFast.rows[0]!.source_sha256, computeSourceSha256(BLUE_PNG));

      releasePublish!();
      const slowReport = await slow;
      assert.ok(slowReport.filesSkipped >= 1 || slowReport.filesPrepared === 0);

      const finalRow = await clientB.query<{ source_sha256: string }>(
        `SELECT source_sha256 FROM onec_catalog_image_assets WHERE source_path = 'images/race.png'`,
      );
      assert.equal(finalRow.rows[0]!.source_sha256, computeSourceSha256(BLUE_PNG));
    } finally {
      releaseSourceRead?.();
      releasePublish?.();
      clientA.release();
      clientB.release();
    }
  });

  it("processes valid file after several missing paths within one maxFiles run", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки>
      <Картинка>images/missing-a.png</Картинка>
      <Картинка>images/missing-b.png</Картинка>
      <Картинка>images/ok.png</Картинка>
    </Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/ok.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const report = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(report.filesFailed, 2);
      assert.equal(report.filesPrepared, 1);
      const row = await client.query<{ source_path: string }>(
        `SELECT source_path FROM onec_catalog_image_assets WHERE status = 'ready'`,
      );
      assert.deepEqual(row.rows.map((item) => item.source_path), ["images/ok.png"]);
    } finally {
      client.release();
    }
  });

  it("uses a fresh queue cursor when active catalog version changes", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/v1-a.png</Картинка><Картинка>images/v1-b.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/v1-a.png"), VALID_PNG);
    await fs.writeFile(path.join(sourceDir, "images/v1-b.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const first = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(first.filesPrepared, 1);
      assert.equal(first.stoppedByLimit, true);

      await applyDistributionXml(
        databaseUrl,
        `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one v2">
    <Картинки><Картинка>images/v2-only.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
      );
      await fs.writeFile(path.join(sourceDir, "images/v2-only.png"), VALID_PNG);

      const second = await runCatalogImageSync(client, { apply: true, maxFiles: 1 });
      assert.equal(second.filesPrepared, 1);
      const row = await client.query<{ source_path: string }>(
        `SELECT source_path FROM onec_catalog_image_assets WHERE status = 'ready' AND source_path = 'images/v2-only.png'`,
      );
      assert.equal(row.rowCount, 1);
    } finally {
      client.release();
    }
  });

  it("does not mutate assets, queue, cursor or storage during dry-run", async () => {
    await prepareDatabase(databaseUrl);
    const { versionId } = await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки>
      <Картинка>images/dry-missing.png</Картинка>
      <Картинка>images/dry-a.png</Картинка>
      <Картинка>images/dry-b.png</Картинка>
    </Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/dry-a.png"), VALID_PNG);
    await fs.writeFile(path.join(sourceDir, "images/dry-b.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const applyFirst = await runCatalogImageSync(client, { apply: true, maxFiles: 2 });
      assert.equal(applyFirst.filesPrepared, 2);
      const beforeDry = await snapshotQueueState(client, versionId, storageDir);

      const dry = await runCatalogImageSync(client, {
        apply: false,
        maxFiles: 5,
        maxBytes: VALID_PNG.length,
      });
      assert.equal(dry.mode, "dry_run");
      assert.equal(dry.filesFailed, 1);
      assert.equal(dry.filesSkipped, 1);
      assert.equal(dry.stoppedByLimit, true);
      assert.equal(dry.sourceBytesRead, VALID_PNG.length);

      const afterDry = await snapshotQueueState(client, versionId, storageDir);
      assert.deepEqual(afterDry.assets, beforeDry.assets);
      assert.deepEqual(afterDry.queue, beforeDry.queue);
      assert.equal(afterDry.cursor, beforeDry.cursor);
      assert.equal(afterDry.storageCount, beforeDry.storageCount);

      const applyAfterDry = await runCatalogImageSync(client, { apply: true, maxFiles: 5, maxBytes: 4096 });
      assert.equal(applyAfterDry.queueComplete, true);
      assert.equal(applyAfterDry.filesSkipped, 2);
      const afterApply = await snapshotQueueState(client, versionId, storageDir);
      assert.deepEqual(afterApply.assets, beforeDry.assets);
      assert.equal(afterApply.cursor, beforeDry.cursor);
    } finally {
      client.release();
    }
  });

  it("counts verified skip reads in sourceBytesRead and stops within maxBytes budget", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки>
      <Картинка>images/budget-a.png</Картинка>
      <Картинка>images/budget-b.png</Картинка>
      <Картинка>images/budget-c.png</Картинка>
    </Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/budget-a.png"), VALID_PNG);
    await fs.writeFile(path.join(sourceDir, "images/budget-b.png"), VALID_PNG);
    await fs.writeFile(path.join(sourceDir, "images/budget-c.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      const seeded = await runCatalogImageSync(client, { apply: true, maxFiles: 3 });
      assert.equal(seeded.filesPrepared, 3);

      const perFileBytes = VALID_PNG.length;
      const maxBytes = perFileBytes * 2;
      const limited = await runCatalogImageSync(client, { apply: true, maxFiles: 5, maxBytes });
      assert.equal(limited.stoppedByLimit, true);
      assert.ok(limited.filesSkipped >= 1);
      assert.ok(limited.sourceBytesRead > 0);
      assert.ok(limited.sourceBytesRead <= maxBytes);

      const continued = await runCatalogImageSync(client, { apply: true, maxFiles: 5, maxBytes: 1024 });
      assert.equal(continued.filesSkipped, 3);
      assert.equal(continued.queueComplete, true);
    } finally {
      client.release();
    }
  });

  it("returns partial report when an unexpected error occurs mid-run", async () => {
    await prepareDatabase(databaseUrl);
    await applyDistributionXml(
      databaseUrl,
      `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/partial-a.png</Картинка><Картинка>images/partial-b.png</Картинка></Картинки>
    <Свойства><Свойство Код="type" Название="Тип товара" Значение="Складская"/></Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`,
    );
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "images/partial-a.png"), VALID_PNG);
    await fs.writeFile(path.join(sourceDir, "images/partial-b.png"), VALID_PNG);

    const client = await pool.connect();
    try {
      let publishCount = 0;
      const report = await runCatalogImageSync(client, {
        apply: true,
        maxFiles: 5,
        testHooks: {
          beforePublish: async () => {
            publishCount += 1;
            if (publishCount === 2) {
              throw new Error("Injected publish failure.");
            }
          },
        },
      });
      assert.equal(report.filesPrepared, 1);
      assert.ok(report.errors.length >= 1);
      assert.match(report.errors.map((item) => item.message).join(" "), /Injected publish failure|Superseded/);
    } finally {
      client.release();
    }
  });
});
