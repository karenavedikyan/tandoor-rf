import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
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
import { addTransferAttachmentsInTransaction } from "../../src/tan-tracker/attachment-mutations";
import { withTransaction } from "../../src/access/db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite, findPartyByUserId } from "../../src/tan-tracker/repository";
import { loadPartyEmployeeMap } from "../../src/tan-tracker/party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "../../src/tan-tracker/team-scope";

const PASS = "AddAttach!2026";
const FILE = Buffer.alloc(5 * 1024 * 1024, 0x41);

async function linkOnClient(
  client: PoolClient,
  userId: string,
  transferId: string,
  stagingId: string,
): Promise<void> {
  await linkStagedAttachmentsToTransfer(client, userId, transferId, [stagingId]);
  await client.query("COMMIT");
}

describe("tan-tracker concurrent attachment add", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let userId = "";
  let holderPartyId = "";
  let cookie = "";
  let employeeId: string | null = null;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-attachments-add-concurrency-test");
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    app = createApp();

    const user = await createTestUser({
      databaseUrl,
      email: "tt-add-concurrency@test.local",
      password: PASS,
      fullName: "Add Concurrency",
      role: "manager",
    });
    userId = user.id;
    const emp = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Add Concurrency', 'Manager', '{}')`,
        [emp],
      );
      employeeId = emp;
      await linkUserToEmployee({
        databaseUrl,
        userId: user.id,
        employeeId: emp,
        confirmedByUserId: user.id,
      });
      await ensurePartyForUserOnWrite(client, user.id, "Add Concurrency", "+79993334455");
      holderPartyId = (await findPartyByUserId(client, user.id))!.id;
    } finally {
      client.release();
    }

    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-add-concurrency@test.local", password: PASS });
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  });

  after(async () => {
    await pool?.end();
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  async function createTransfer(id: string): Promise<void> {
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
       VALUES ($1,$1,'Concurrency test','active',$2::uuid,$2::uuid,1,1)
       ON CONFLICT (id) DO NOTHING`,
      [id, holderPartyId],
    );
  }

  async function scopeCtx() {
    const access = { employeeId, preview: null } as import("../../src/access/types").AccessContext;
    return {
      scopeCtx: {
        userId,
        role: "manager",
        employeeId,
        actorPartyId: holderPartyId,
        previewReadOnly: false,
      },
      teamGuids: await loadTanTrackerTeamEmployeeGuids({ ...access, userId, role: "manager" }),
      partyMap: await loadPartyEmployeeMap(pool, []),
    };
  }

  it("successful add via API links staged file", async () => {
    const tid = "TT-ADD-OK";
    await createTransfer(tid);
    const staged = await stageAttachmentBuffer(userId, "ok.txt", "text/plain", Buffer.from("ok"));
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(tid)}/attachments`)
      .set({
        Origin: process.env.APP_ORIGIN!,
        Cookie: cookie,
        "Content-Type": "application/json",
      })
      .send({ stagingAttachmentIds: [staged.id] });
    assert.equal(res.status, 200);
    const linked = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE transfer_id = $1`, [tid]);
    assert.equal(linked.rows[0]?.c, 1);
    const consumed = await pool.query(`SELECT consumed_at IS NOT NULL AS ok FROM tt_staged_attachments WHERE id = $1::uuid`, [
      staged.id,
    ]);
    assert.equal(consumed.rows[0]?.ok, true);
  });

  it("rejects add on completed transfer without consuming staged rows", async () => {
    const tid = "TT-ADD-COMPLETED";
    await createTransfer(tid);
    await pool.query(`UPDATE tt_transfers SET status = 'completed' WHERE id = $1`, [tid]);
    const staged = await stageAttachmentBuffer(userId, "blocked.txt", "text/plain", Buffer.from("x"));
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(tid)}/attachments`)
      .set({
        Origin: process.env.APP_ORIGIN!,
        Cookie: cookie,
        "Content-Type": "application/json",
      })
      .send({ stagingAttachmentIds: [staged.id] });
    assert.equal(res.status, 403);
    const meta = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE transfer_id = $1`, [tid]);
    assert.equal(meta.rows[0]?.c, 0);
    const row = await pool.query(`SELECT consumed_at FROM tt_staged_attachments WHERE id = $1::uuid`, [staged.id]);
    assert.equal(row.rows[0]?.consumed_at, null);
    const blob = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_attachment_blobs b
       JOIN tt_staged_attachments s ON s.storage_key = b.storage_key WHERE s.id = $1::uuid`,
      [staged.id],
    );
    assert.equal(blob.rows[0]?.c, 1);
  });

  it("serializes concurrent adds so file count never exceeds 10", async () => {
    const tid = "TT-ADD-LIMIT-CNT";
    await createTransfer(tid);
    for (let i = 0; i < 9; i++) {
      const staged = await stageAttachmentBuffer(userId, `f${i}.txt`, "text/plain", Buffer.from(`f${i}`));
      await withTransaction(async (client) => {
        await linkStagedAttachmentsToTransfer(client, userId, tid, [staged.id]);
      });
    }
    const s1 = await stageAttachmentBuffer(userId, "extra1.txt", "text/plain", Buffer.from("e1"));
    const s2 = await stageAttachmentBuffer(userId, "extra2.txt", "text/plain", Buffer.from("e2"));

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const results = await Promise.allSettled([
        linkOnClient(c1, userId, tid, s1.id),
        linkOnClient(c2, userId, tid, s2.id),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected").length;
      assert.equal(fulfilled, 1);
      assert.equal(rejected, 1);
    } finally {
      try {
        await c1.query("ROLLBACK");
      } catch {
        /* committed or rolled back */
      }
      try {
        await c2.query("ROLLBACK");
      } catch {
        /* committed or rolled back */
      }
      c1.release();
      c2.release();
    }

    const count = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE transfer_id = $1`, [tid]);
    assert.equal(count.rows[0]?.c, 10);
    const unconsumed = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_staged_attachments WHERE id = ANY($1::uuid[]) AND consumed_at IS NULL`,
      [[s1.id, s2.id]],
    );
    assert.equal(unconsumed.rows[0]?.c, 1);
  });

  it("serializes concurrent adds so total bytes never exceed 50MB", async () => {
    const tid = "TT-ADD-LIMIT-BYTES";
    await createTransfer(tid);
    for (let i = 0; i < 9; i++) {
      const staged = await stageAttachmentBuffer(userId, `big${i}.txt`, "text/plain", FILE);
      await withTransaction(async (client) => {
        await linkStagedAttachmentsToTransfer(client, userId, tid, [staged.id]);
      });
    }
    const s1 = await stageAttachmentBuffer(userId, "bigA.txt", "text/plain", FILE);
    const s2 = await stageAttachmentBuffer(userId, "bigB.txt", "text/plain", FILE);

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const results = await Promise.allSettled([
        linkOnClient(c1, userId, tid, s1.id),
        linkOnClient(c2, userId, tid, s2.id),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    } finally {
      try {
        await c1.query("ROLLBACK");
      } catch {
        /* noop */
      }
      try {
        await c2.query("ROLLBACK");
      } catch {
        /* noop */
      }
      c1.release();
      c2.release();
    }

    const total = await pool.query(
      `SELECT COALESCE(SUM(byte_size),0)::bigint AS t FROM tt_transfer_attachments WHERE transfer_id = $1`,
      [tid],
    );
    assert.equal(Number(total.rows[0]?.t ?? 0), 50 * 1024 * 1024);
  });

  it("add fails when transfer completed under concurrent row lock", async () => {
    const tid = "TT-ADD-RACE";
    await createTransfer(tid);
    const staged = await stageAttachmentBuffer(userId, "race.txt", "text/plain", Buffer.from("race"));
    const { scopeCtx: ctx, teamGuids, partyMap } = await scopeCtx();

    const completer = await pool.connect();
    try {
      await completer.query("BEGIN");
      await completer.query(`SELECT id FROM tt_transfers WHERE id = $1 FOR UPDATE`, [tid]);
      await completer.query(`UPDATE tt_transfers SET status = 'completed' WHERE id = $1`, [tid]);

      const addPromise = withTransaction(async (client) => {
        await addTransferAttachmentsInTransaction(client, {
          transferId: tid,
          userId,
          stagingIds: [staged.id],
          actorPartyId: holderPartyId,
          scopeCtx: ctx,
          teamGuids,
          partyMap,
        });
      });

      await completer.query("COMMIT");
      await assert.rejects(addPromise, (err: unknown) => {
        assert.equal((err as { http?: number }).http, 403);
        return true;
      });
    } finally {
      completer.release();
    }

    const consumed = await pool.query(`SELECT consumed_at FROM tt_staged_attachments WHERE id = $1::uuid`, [staged.id]);
    assert.equal(consumed.rows[0]?.consumed_at, null);
    assert.equal(
      (await pool.query(`SELECT status FROM tt_transfers WHERE id = $1`, [tid])).rows[0]?.status,
      "completed",
    );
  });
});
