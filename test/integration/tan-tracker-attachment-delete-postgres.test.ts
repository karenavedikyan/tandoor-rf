import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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
import { deleteTransferAttachmentInTransaction } from "../../src/tan-tracker/attachment-mutations";
import { linkStagedAttachmentsToTransfer, stageAttachmentBuffer } from "../../src/tan-tracker/attachments";
import { withTransaction } from "../../src/access/db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite, findPartyByUserId } from "../../src/tan-tracker/repository";
import { loadPartyEmployeeMap } from "../../src/tan-tracker/party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "../../src/tan-tracker/team-scope";

const FILE = Buffer.from("delete-atomic-bytes", "utf8");
const PASS = "DeleteAttach!2026";

async function installBlobDeleteFailTrigger(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION tt_test_fail_blob_delete() RETURNS trigger AS $$
    BEGIN
      IF current_setting('tt.test_fail_blob_delete', true) = '1' THEN
        RAISE EXCEPTION 'injected blob delete failure';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS tt_test_blob_delete ON tt_attachment_blobs`);
  await pool.query(`
    CREATE TRIGGER tt_test_blob_delete
    BEFORE DELETE ON tt_attachment_blobs
    FOR EACH ROW EXECUTE FUNCTION tt_test_fail_blob_delete()
  `);
}

describe("tan-tracker postgres attachment delete integrity", { concurrency: false }, () => {
  let databaseUrl = "";
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let holderId = "";
  let holderCookie = "";
  let holderPartyId = "";
  let otherCookie = "";
  let transferId = "";
  let attId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    process.env.TT_ATTACHMENTS_BACKEND = "postgres";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt-attachments-delete-test");
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await installBlobDeleteFailTrigger(pool);
    app = createApp();

    const holder = await createTestUser({
      databaseUrl,
      email: "tt-del-holder@test.local",
      password: PASS,
      fullName: "Del Holder",
      role: "manager",
    });
    holderId = holder.id;
    const other = await createTestUser({
      databaseUrl,
      email: "tt-del-other@test.local",
      password: PASS,
      fullName: "Del Other",
      role: "manager",
    });
    const emp = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Del Holder', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: holder.id,
        employeeId: emp,
        confirmedByUserId: holder.id,
      });
      await ensurePartyForUserOnWrite(client, holder.id, "Del Holder", "+79992223344");
      holderPartyId = (await findPartyByUserId(client, holder.id))!.id;
      await ensurePartyForUserOnWrite(client, other.id, "Del Other", "+79992223355");
    } finally {
      client.release();
    }

    const loginHolder = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-del-holder@test.local", password: PASS });
    holderCookie = loginHolder.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const loginOther = await request(app)
      .post("/api/auth/login")
      .set({ Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" })
      .send({ email: "tt-del-other@test.local", password: PASS });
    otherCookie = loginOther.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const staged = await stageAttachmentBuffer(holderId, "del.txt", "text/plain", FILE);
    transferId = "TT-DEL-01";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1,$1,'Delete test','active',$2::uuid,$2::uuid,1,1)`,
        [transferId, holderPartyId],
      );
      await linkStagedAttachmentsToTransfer(client, holderId, transferId, [staged.id]);
    });
    attId = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_transfer_attachments WHERE transfer_id = $1`,
        [transferId],
      )
    ).rows[0]!.id;
  });

  after(async () => {
    await pool?.end();
    await closePool();
    delete process.env.TT_ATTACHMENTS_BACKEND;
  });

  it("DELETE API removes metadata and blob together", async () => {
    const res = await request(app)
      .delete(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/attachments/${encodeURIComponent(attId)}`)
      .set({
        Origin: process.env.APP_ORIGIN!,
        Cookie: holderCookie,
        "Content-Type": "application/json",
      });
    assert.equal(res.status, 200);
    const meta = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE id = $1::uuid`, [attId]);
    assert.equal(meta.rows[0]?.c, 0);
    const blobs = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_attachment_blobs`);
    assert.equal(blobs.rows[0]?.c, 0);
  });

  it("rolls back metadata when blob DELETE fails", async () => {
    const staged = await stageAttachmentBuffer(holderId, "del2.txt", "text/plain", FILE);
    const tid = "TT-DEL-02";
    let localAttId = "";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1,$1,'Delete test 2','active',$2::uuid,$2::uuid,1,1)`,
        [tid, holderPartyId],
      );
      await linkStagedAttachmentsToTransfer(client, holderId, tid, [staged.id]);
    });
    localAttId = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_transfer_attachments WHERE transfer_id = $1`,
        [tid],
      )
    ).rows[0]!.id;
    const storageKey = (
      await pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM tt_transfer_attachments WHERE id = $1::uuid`,
        [localAttId],
      )
    ).rows[0]!.storage_key;

    const empRow = await pool.query<{ employee_id: string }>(
      `SELECT employee_id::text FROM user_onec_employee_links WHERE user_id = $1::uuid AND revoked_at IS NULL LIMIT 1`,
      [holderId],
    );
    const employeeId = empRow.rows[0]?.employee_id ?? null;
    const access = { employeeId, preview: null } as import("../../src/access/types").AccessContext;
    const scopeCtx = {
      userId: holderId,
      role: "manager",
      employeeId,
      actorPartyId: holderPartyId,
      previewReadOnly: false,
    };
    const teamGuids = await loadTanTrackerTeamEmployeeGuids({
      ...access,
      userId: holderId,
      role: "manager",
    });
    const partyMap = await loadPartyEmployeeMap(pool, []);
    await assert.rejects(async () => {
      await withTransaction(async (client) => {
        await client.query(`SELECT set_config('tt.test_fail_blob_delete', '1', true)`);
        await deleteTransferAttachmentInTransaction(client, {
          transferId: tid,
          attId: localAttId,
          actorPartyId: holderPartyId,
          scopeCtx,
          teamGuids,
          partyMap,
        });
      });
    });

    const meta = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE id = $1::uuid`, [
      localAttId,
    ]);
    assert.equal(meta.rows[0]?.c, 1);
    const blob = await pool.query(`SELECT COUNT(*)::int AS c FROM tt_attachment_blobs WHERE storage_key = $1`, [
      storageKey,
    ]);
    assert.equal(blob.rows[0]?.c, 1);
  });

  it("forbids delete by non-holder and on completed transfer", async () => {
    const staged = await stageAttachmentBuffer(holderId, "del3.txt", "text/plain", FILE);
    const tid = "TT-DEL-03";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1,$1,'Delete test 3','active',$2::uuid,$2::uuid,1,1)`,
        [tid, holderPartyId],
      );
      await linkStagedAttachmentsToTransfer(client, holderId, tid, [staged.id]);
    });
    const localAttId = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_transfer_attachments WHERE transfer_id = $1`,
        [tid],
      )
    ).rows[0]!.id;

    const delHeaders = {
      Origin: process.env.APP_ORIGIN!,
      "Content-Type": "application/json",
    };
    const forbidden = await request(app)
      .delete(`/api/tan-tracker/transfers/${encodeURIComponent(tid)}/attachments/${encodeURIComponent(localAttId)}`)
      .set({ ...delHeaders, Cookie: otherCookie });
    assert.equal(forbidden.status, 403);

    await pool.query(`UPDATE tt_transfers SET status = 'completed' WHERE id = $1`, [tid]);
    const completed = await request(app)
      .delete(`/api/tan-tracker/transfers/${encodeURIComponent(tid)}/attachments/${encodeURIComponent(localAttId)}`)
      .set({ ...delHeaders, Cookie: holderCookie });
    assert.equal(completed.status, 403);
  });

  it("rejects linking staged attachment owned by another user", async () => {
    const otherUser = await createTestUser({
      databaseUrl,
      email: `tt-del-stranger-${randomUUID().slice(0, 8)}@test.local`,
      password: PASS,
      fullName: "Stranger",
      role: "manager",
    });
    const staged = await stageAttachmentBuffer(otherUser.id, "foreign.txt", "text/plain", FILE);
    const tid = "TT-DEL-04";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
         VALUES ($1,$1,'Delete test 4','active',$2::uuid,$2::uuid,1,1)`,
        [tid, holderPartyId],
      );
    });
    await assert.rejects(async () => {
      await withTransaction(async (client) => {
        await linkStagedAttachmentsToTransfer(client, holderId, tid, [staged.id]);
      });
    });
  });

  it("child process reads bytes after pool reset (no local fs)", async () => {
    const staged = await stageAttachmentBuffer(holderId, "restart.txt", "text/plain", FILE);
    const storageKey = (
      await pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM tt_staged_attachments WHERE id = $1::uuid`,
        [staged.id],
      )
    ).rows[0]!.storage_key;

    await closePool();
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `import { readAttachmentBytes } from "./src/tan-tracker/attachment-storage.ts";
         const buf = await readAttachmentBytes(${JSON.stringify(storageKey)});
         if (buf.toString("utf8") !== ${JSON.stringify(FILE.toString("utf8"))}) process.exit(2);
         process.stdout.write("OK");`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          TT_ATTACHMENTS_BACKEND: "postgres",
          TT_ATTACHMENTS_DIR: process.env.TT_ATTACHMENTS_DIR,
          NODE_ENV: "test",
        },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout, /OK/);
    await resetPoolForTests();
  });
});
