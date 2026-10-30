import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
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

describe("tan-tracker attachment preview vs download disposition (PG)", { concurrency: false }, () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let cookie = "";
  let otherCookie = "";
  let transferId = "";
  let attId = "";

  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-att-preview-disposition");
    await fs.mkdir(process.env.TT_ATTACHMENTS_DIR, { recursive: true });
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    app = createApp();

    const user = await createTestUser({
      databaseUrl,
      email: "tt-att-preview@test.local",
      password: "AttPreview!2026",
      fullName: "Att Preview",
      role: "manager",
    });
    const other = await createTestUser({
      databaseUrl,
      email: "tt-att-preview-other@test.local",
      password: "AttPreview!2026",
      fullName: "Other",
      role: "manager",
    });
    const emp = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Preview', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
      await ensurePartyForUserOnWrite(client, user.id, "Att Preview", "+79991110001");
      await ensurePartyForUserOnWrite(client, other.id, "Other", "+79991110002");
    } finally {
      client.release();
    }

    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-att-preview@test.local", password: "AttPreview!2026" });
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const loginOther = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-att-preview-other@test.local", password: "AttPreview!2026" });
    otherCookie = loginOther.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const staged = await stageAttachmentBuffer(user.id, "preview.jpg", "image/jpeg", Buffer.from("jpeg-preview-bytes"));
    transferId = `TT-PREV-${randomUUID().slice(0, 8)}`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version)
         SELECT $1, $1, 'Preview box', 'active', p.id, p.id, 0 FROM tt_parties p WHERE p.user_id = $2::uuid LIMIT 1`,
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

  it("returns inline disposition for preview query on JPEG", async () => {
    const res = await request(app)
      .get(`${attPath()}?preview=1`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-disposition"]), /^inline;/i);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });

  it("returns attachment disposition for download query", async () => {
    const res = await request(app)
      .get(`${attPath()}?download=1`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-disposition"]), /^attachment;/i);
  });

  it("forbids preview for user without transfer access", async () => {
    const res = await request(app)
      .get(`${attPath()}?preview=1`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: otherCookie });
    assert.equal(res.status, 403);
  });

  it("requires auth for attachment download", async () => {
    const res = await request(app).get(`${attPath()}?download=1`).set({ Origin: process.env.APP_ORIGIN! });
    assert.equal(res.status, 401);
  });
});
