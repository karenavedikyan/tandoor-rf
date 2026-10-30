import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../src/server";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { linkStagedAttachmentsToTransfer, stageAttachmentBuffer } from "../../src/tan-tracker/attachments";
import { withTransaction } from "../../src/access/db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

describe("tan-tracker attachment raster preview (PG)", { concurrency: false }, () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let cookie = "";
  let otherCookie = "";
  let transferId = "";
  let attId = "";
  let originalBytes = Buffer.alloc(0);

  before(async () => {
    originalBytes = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    assert.ok(originalBytes.length > 8_000, "test original should be a non-trivial JPEG");

    const databaseUrl = getIntegrationDatabaseUrl();
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-att-raster-preview");
    await fs.mkdir(process.env.TT_ATTACHMENTS_DIR, { recursive: true });
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    app = createApp();

    const user = await createTestUser({
      databaseUrl,
      email: "tt-att-raster@test.local",
      password: "AttRaster!2026",
      fullName: "Att Raster",
      role: "manager",
    });
    const other = await createTestUser({
      databaseUrl,
      email: "tt-att-raster-other@test.local",
      password: "AttRaster!2026",
      fullName: "Other",
      role: "manager",
    });
    const emp = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Raster', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
      await ensurePartyForUserOnWrite(client, user.id, "Att Raster", "+79992220001");
      await ensurePartyForUserOnWrite(client, other.id, "Other", "+79992220002");
    } finally {
      client.release();
    }

    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-att-raster@test.local", password: "AttRaster!2026" });
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const loginOther = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-att-raster-other@test.local", password: "AttRaster!2026" });
    otherCookie = loginOther.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const staged = await stageAttachmentBuffer(user.id, "large.jpg", "image/jpeg", originalBytes);
    transferId = `TT-RAST-${randomUUID().slice(0, 8)}`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version)
         SELECT $1, $1, 'Raster box', 'active', p.id, p.id, 0 FROM tt_parties p WHERE p.user_id = $2::uuid LIMIT 1`,
        [transferId, user.id],
      );
      await linkStagedAttachmentsToTransfer(client, user.id, transferId, [staged.id]);
    });
    attId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_transfer_attachments WHERE transfer_id = $1`, [
        transferId,
      ])
    ).rows[0]!.id;
  });

  after(async () => {
    await pool?.end();
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  const attPath = () =>
    `/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/attachments/${encodeURIComponent(attId)}`;

  it("bare GET returns original bytes (backward compatible)", async () => {
    const bare = await request(app)
      .get(attPath())
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(bare.status, 200);
    assert.equal(bare.headers["content-type"], "image/jpeg");
    assert.deepEqual(Buffer.from(bare.body), originalBytes);
  });

  it("serves bounded thumb and lightbox previews without re-upload (lazy generate)", async () => {
    const thumb = await request(app)
      .get(`${attPath()}?preview=thumb`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers["content-type"], "image/jpeg");
    assert.ok(Buffer.byteLength(thumb.body) < originalBytes.length / 5);
    const thumbMeta = await sharp(thumb.body).metadata();
    assert.ok((thumbMeta.width ?? 0) <= 320);
    assert.ok((thumbMeta.height ?? 0) <= 320);

    const lightbox = await request(app)
      .get(`${attPath()}?preview=lightbox`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(lightbox.status, 200);
    assert.ok(Buffer.byteLength(lightbox.body) < originalBytes.length);
    assert.ok(Buffer.byteLength(lightbox.body) > Buffer.byteLength(thumb.body));
    const lbMeta = await sharp(lightbox.body).metadata();
    assert.ok((lbMeta.width ?? 0) <= 1600);
    assert.ok((lbMeta.height ?? 0) <= 1600);

    const thumbCached = await request(app)
      .get(`${attPath()}?preview=thumb`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(thumbCached.status, 200);
    assert.equal(Buffer.byteLength(thumbCached.body), Buffer.byteLength(thumb.body));
  });

  it("download preserves original bytes and uses attachment disposition", async () => {
    const res = await request(app)
      .get(`${attPath()}?download=1`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-disposition"]), /^attachment;/i);
    assert.equal(res.headers["content-type"], "image/jpeg");
    assert.deepEqual(Buffer.from(res.body), originalBytes);
  });

  it("forbids preview for user without transfer access and does not cache derivatives", async () => {
    const previewKeySuffix = ".preview-v1-thumb.jpg";
    const before = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM tt_attachment_blobs WHERE storage_key LIKE $1`,
      [`%${previewKeySuffix}`],
    );
    const res = await request(app)
      .get(`${attPath()}?preview=thumb`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: otherCookie });
    assert.equal(res.status, 403);
    const after = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM tt_attachment_blobs WHERE storage_key LIKE $1`,
      [`%${previewKeySuffix}`],
    );
    assert.equal(after.rowCount, before.rowCount);
  });

  it("deletes cached preview blobs when attachment is removed", async () => {
    await request(app)
      .get(`${attPath()}?preview=thumb`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    await request(app)
      .get(`${attPath()}?preview=lightbox`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    const storageKey = (
      await pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM tt_transfer_attachments WHERE id = $1::uuid`,
        [attId],
      )
    ).rows[0]!.storage_key;
    const cached = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_attachment_blobs WHERE storage_key LIKE $1`, [
      `${storageKey}.preview-v1-%`,
    ]);
    assert.ok((cached.rows[0]?.c ?? 0) >= 2);

    const del = await request(app)
      .delete(`${attPath()}`)
      .set({
        Origin: process.env.APP_ORIGIN!,
        Cookie: cookie,
        "Content-Type": "application/json",
      });
    assert.equal(del.status, 200);
    const remaining = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_attachment_blobs WHERE storage_key LIKE $1`, [
      `${storageKey}%`,
    ]);
    assert.equal(remaining.rows[0]?.c, 0);
  });
});
