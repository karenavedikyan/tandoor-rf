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
import { stageAttachmentBuffer, readAttachmentBytes, linkStagedAttachmentsToTransfer } from "../../src/tan-tracker/attachments";
import { withTransaction } from "../../src/access/db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const FILE = Buffer.from("durable-postgres-attachment-bytes", "utf8");

describe("tan-tracker durable postgres attachments", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let userId = "";
  let cookie = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-attachments-durable-test");
    await fs.mkdir(process.env.TT_ATTACHMENTS_DIR, { recursive: true });
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    app = createApp();

    const user = await createTestUser({
      databaseUrl,
      email: "tt-durable-a@test.local",
      password: "DurableAttach!2026",
      fullName: "Durable A",
      role: "manager",
    });
    userId = user.id;
    const emp = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Durable', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
      await ensurePartyForUserOnWrite(client, user.id, "Durable A", "+79991112233");
    } finally {
      client.release();
    }

    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-durable-a@test.local", password: "DurableAttach!2026" });
    assert.equal(login.status, 200);
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  });

  after(async () => {
    await pool?.end();
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  it("stores bytes in postgres and survives empty local attachments dir", async () => {
    const staged = await stageAttachmentBuffer(userId, "proof.txt", "text/plain", FILE);
    const attachDir = process.env.TT_ATTACHMENTS_DIR!;
    const stagedPath = path.join(attachDir, "staged", userId);
    await assert.rejects(() => fs.access(stagedPath));

    const blob = await pool.query(
      `SELECT b.byte_size::int AS n FROM tt_attachment_blobs b
       JOIN tt_staged_attachments s ON s.storage_key = b.storage_key
       WHERE s.id = $1::uuid`,
      [staged.id],
    );
    assert.equal(blob.rows[0]?.n, FILE.length);

    let transferId = "";
    await withTransaction(async (client) => {
      const party = (
        await client.query<{ id: string }>(
          `SELECT id::text FROM tt_parties WHERE user_id = $1::uuid LIMIT 1`,
          [userId],
        )
      ).rows[0]!;
      transferId = "TT-DUR-01";
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1,$1,'Durable item','active',$2::uuid,$2::uuid,1,1)`,
        [transferId, party.id],
      );
      await linkStagedAttachmentsToTransfer(client, userId, transferId, [staged.id]);
    });

    const readBack = await readAttachmentBytes(
      (
        await pool.query<{ storage_key: string }>(
          `SELECT storage_key FROM tt_transfer_attachments WHERE transfer_id = $1`,
          [transferId],
        )
      ).rows[0]!.storage_key,
      pool,
    );
    assert.equal(readBack.toString("utf8"), FILE.toString("utf8"));

    const attId = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_transfer_attachments WHERE transfer_id = $1`,
        [transferId],
      )
    ).rows[0]!.id;

    const dl = await request(app)
      .get(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/attachments/${encodeURIComponent(attId)}`)
      .set({ Origin: process.env.APP_ORIGIN!, Cookie: cookie });
    assert.equal(dl.status, 200);
    assert.equal(dl.text, FILE.toString("utf8"));
  });

  it("rolls back blob row when staged insert fails", async () => {
    const key = `staged/${userId}/rollback-test.bin`;
    await assert.rejects(async () => {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO tt_attachment_blobs (storage_key, content, byte_size) VALUES ($1, $2, $3)`,
          [key, FILE, FILE.length],
        );
        await client.query(`SELECT 1/0`);
      });
    });
    const n = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_attachment_blobs WHERE storage_key = $1`, [key]);
    assert.equal(n.rows[0]?.c, 0);
  });
});
