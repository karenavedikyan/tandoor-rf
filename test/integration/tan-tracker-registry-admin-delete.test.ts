import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const SESSION_TOKEN_HEX = "a".repeat(64);

describe("tan-tracker admin force delete (isolated PG)", { concurrency: false }, () => {
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let pool: Pool;
  let adminCookie = "";
  let directorCookie = "";
  let managerCookie = "";
  let adminUserId = "";
  let managerUserId = "";
  let managerPartyId = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    await createTestUser({
      databaseUrl,
      email: "admin-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Admin",
      role: "admin",
    });
    const director = await createTestUser({
      databaseUrl,
      email: "director-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Director",
      role: "director",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-force-del@test.local",
      password: PASSWORD,
      fullName: "Force Delete Manager",
      role: "manager",
    });
    managerUserId = manager.id;
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });

    adminUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, ["admin-force-del@test.local"])
    ).rows[0]!.id;
    const client = await pool.connect();
    const managerEmployeeId = randomUUID();
    try {
      managerPartyId = (await ensurePartyForUserOnWrite(client, managerUserId, "Force Delete Manager", null)).id;
      await ensurePartyForUserOnWrite(client, adminUserId, "Force Delete Admin", null);
      await ensurePartyForUserOnWrite(client, director.id, "Force Delete Director", null);
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Force Delete Manager', 'Manager', '{}')`,
        [managerEmployeeId],
      );
    } finally {
      client.release();
    }
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUserId,
      employeeId: managerEmployeeId,
      confirmedByUserId: adminUserId,
    });

    const loginAdmin = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "admin-force-del@test.local", password: PASSWORD });
    adminCookie = loginAdmin.headers["set-cookie"]![0]!.split(";")[0]!;
    const loginDirector = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "director-force-del@test.local", password: PASSWORD });
    directorCookie = loginDirector.headers["set-cookie"]![0]!.split(";")[0]!;
    const loginManager = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "manager-force-del@test.local", password: PASSWORD });
    managerCookie = loginManager.headers["set-cookie"]![0]!.split(";")[0]!;
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  async function insertTransfer(opts: {
    id: string;
    code: string;
    status: string;
    creatorPartyId: string;
    holderPartyId: string;
    pendingPartyId?: string | null;
    firstCustodyAt?: "now" | null;
    completedAt?: "now";
    generalArchivedAt?: "now";
    withMessengerSession?: boolean;
    withLegacyAudit?: boolean;
    withAttachment?: boolean;
    withHandoffCode?: boolean;
    withPendingOutbox?: boolean;
    withSentOutbox?: boolean;
  }) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id,
          pending_party_id, handoff_version, row_version, first_custody_at, completed_at, general_archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, $8, $9, $10)`,
        [
          opts.id,
          opts.code,
          "Force delete item",
          opts.status,
          opts.creatorPartyId,
          opts.holderPartyId,
          opts.pendingPartyId ?? null,
          opts.firstCustodyAt === "now" ? new Date() : opts.firstCustodyAt === null ? null : null,
          opts.completedAt === "now" ? new Date() : null,
          opts.generalArchivedAt === "now" ? new Date() : null,
        ],
      );
      if (opts.withMessengerSession) {
        await client.query(
          `INSERT INTO tt_external_messenger_sessions (transfer_id, pending_party_id, handoff_version, token_hash, expires_at)
           VALUES ($1, $2, 1, decode($3, 'hex'), NOW() + interval '1 day')`,
          [opts.id, opts.holderPartyId, SESSION_TOKEN_HEX],
        );
      }
      if (opts.withLegacyAudit) {
        await client.query(
          `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
           VALUES ($1, $2::uuid, $3, 'code_verify_ok', '{}'::jsonb)`,
          [opts.id, adminUserId, opts.creatorPartyId],
        );
      }
      if (opts.withAttachment) {
        await client.query(
          `INSERT INTO tt_transfer_attachments (id, transfer_id, original_name, mime_type, byte_size, storage_key, uploaded_by_user_id)
           VALUES ($1::uuid, $2, 'proof.jpg', 'image/jpeg', 10, $3, $4::uuid)`,
          [randomUUID(), opts.id, `att/${opts.id}/proof.jpg`, adminUserId],
        );
      }
      if (opts.withHandoffCode) {
        await client.query(
          `INSERT INTO tt_handoff_codes (transfer_id, handoff_version, pending_party_id, code_hash, expires_at)
           VALUES ($1, 1, $2, 'hash-demo', NOW() + interval '5 minutes')`,
          [opts.id, opts.holderPartyId],
        );
      }
      if (opts.withPendingOutbox || opts.withSentOutbox) {
        const phoneSuffix = opts.code.replace(/\D/g, "").slice(-10).padStart(10, "1");
        const partyPhone = `+7${phoneSuffix}`;
        const personPhone = `+7${(Number(phoneSuffix) + 1).toString().padStart(10, "0").slice(-10)}`;
        const partyId = (
          await client.query<{ id: string }>(
            `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
             VALUES ('external', 'Outbox ext', $1, $2::uuid)
             RETURNING id::text`,
            [partyPhone, adminUserId],
          )
        ).rows[0]!.id;
        const personId = (
          await client.query<{ id: string }>(
            `INSERT INTO tt_external_persons (phone_e164, display_name, party_id)
             VALUES ($1, 'Outbox person', $2::uuid)
             RETURNING id::text`,
            [personPhone, partyId],
          )
        ).rows[0]!.id;
        if (opts.withPendingOutbox) {
          await client.query(
            `INSERT INTO tt_external_person_message_outbox (
               person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at
             ) VALUES ($1::uuid, 'telegram', '12345', 'Pending body', $2, 'external_person.delivered', 'pending', NOW())`,
            [personId, `tt-ext-msg:delivered:${opts.id}:hv:1:telegram`],
          );
        }
        if (opts.withSentOutbox) {
          await client.query(
            `INSERT INTO tt_external_person_message_outbox (
               person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, next_attempt_at, sent_at
             ) VALUES ($1::uuid, 'max', '67890', 'Sent body', $2, 'external_person.delivered', 'sent', NOW(), NOW())`,
            [personId, `tt-ext-msg:delivered:${opts.id}:hv:1:max`],
          );
        }
        await client.query(
          `INSERT INTO tanbot_notification_outbox (idempotency_key, user_id, channel, event_type, payload, status, next_attempt_at)
           VALUES ($1, $2::uuid, 'telegram', 'tan_tracker.continued', $3::jsonb, 'pending', NOW())`,
          [
            `tt-staff:continued:${opts.id}:hv:1:telegram:${adminUserId}`,
            adminUserId,
            JSON.stringify({
              transferId: opts.id,
              publicCode: opts.code,
              itemTitle: "Force delete item",
              handoffVersion: 1,
            }),
          ],
        );
      }
    } finally {
      client.release();
    }
  }

  it("admin deletes received, completed, and archived tracks with related rows and outbox cleanup", async () => {
    const cases = [
      {
        id: "ttadm0000000000000000000000000001",
        code: "ADMDELRCV",
        status: "active",
        firstCustodyAt: "now" as const,
        withAttachment: true,
        withHandoffCode: true,
        withPendingOutbox: true,
        withSentOutbox: true,
      },
      {
        id: "ttadm0000000000000000000000000002",
        code: "ADMDELDONE",
        status: "completed",
        completedAt: "now" as const,
      },
      {
        id: "ttadm0000000000000000000000000003",
        code: "ADMDELARCH",
        status: "delivered",
        generalArchivedAt: "now" as const,
        withMessengerSession: true,
      },
    ];
    for (const c of cases) {
      await insertTransfer({
        ...c,
        creatorPartyId: managerPartyId,
        holderPartyId: managerPartyId,
      });
    }

    for (const c of cases) {
      const del = await request(app)
        .post("/api/tan-tracker/registry/cleanup")
        .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
        .send({ action: "delete", transferIds: [c.code], deleteAck: "УДАЛИТЬ", adminForceDelete: true });
      assert.equal(del.status, 200, del.text);
      assert.deepEqual(del.body.applied, [c.code]);

      assert.equal((await pool.query(`SELECT 1 FROM tt_transfers WHERE id = $1`, [c.id])).rowCount, 0);
      assert.equal(
        (await pool.query(`SELECT 1 FROM tt_transfer_attachments WHERE transfer_id = $1`, [c.id])).rowCount,
        0,
      );
      assert.equal((await pool.query(`SELECT 1 FROM tt_handoff_codes WHERE transfer_id = $1`, [c.id])).rowCount, 0);
      assert.equal(
        (await pool.query(`SELECT 1 FROM tt_external_messenger_sessions WHERE transfer_id = $1`, [c.id])).rowCount,
        0,
      );

      const audit = await pool.query<{ actor_user_id: string }>(
        `SELECT actor_user_id::text FROM tt_transfer_delete_audit WHERE transfer_public_code = $1`,
        [c.code],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0]!.actor_user_id, adminUserId);

      if (c.withPendingOutbox) {
        const pending = await pool.query<{ status: string }>(
          `SELECT status FROM tt_external_person_message_outbox WHERE idempotency_key = $1`,
          [`tt-ext-msg:delivered:${c.id}:hv:1:telegram`],
        );
        assert.equal(pending.rows[0]?.status, "cancelled");
        const sent = await pool.query<{ status: string }>(
          `SELECT status FROM tt_external_person_message_outbox WHERE idempotency_key = $1`,
          [`tt-ext-msg:delivered:${c.id}:hv:1:max`],
        );
        assert.equal(sent.rows[0]?.status, "sent");
        const staff = await pool.query<{ status: string }>(
          `SELECT status FROM tanbot_notification_outbox WHERE idempotency_key = $1`,
          [`tt-staff:continued:${c.id}:hv:1:telegram:${adminUserId}`],
        );
        assert.equal(staff.rows[0]?.status, "cancelled");
      }
    }
  });

  it("admin deletes legacy-audit track with null first_custody_at", async () => {
    await insertTransfer({
      id: "ttadm0000000000000000000000000004",
      code: "ADMDELLEG",
      status: "active",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: null,
      withLegacyAudit: true,
    });
    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["ADMDELLEG"], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 200);
    assert.deepEqual(del.body.applied, ["ADMDELLEG"]);
  });

  it("non-admin creator denied after receipt; director not admin; pre-receipt creator still allowed", async () => {
    await insertTransfer({
      id: "ttadm0000000000000000000000000005",
      code: "MGRDELRCV",
      status: "active",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: "now",
    });
    await insertTransfer({
      id: "ttadm0000000000000000000000000006",
      code: "MGRDELPEND",
      status: "waiting",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      firstCustodyAt: null,
    });
    await insertTransfer({
      id: "ttadm0000000000000000000000000007",
      code: "DIRDELDONE",
      status: "completed",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      completedAt: "now",
    });

    const mgrDenied = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: managerCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["MGRDELRCV"], deleteAck: "УДАЛИТЬ" });
    assert.equal(mgrDenied.status, 200);
    assert.equal(mgrDenied.body.applied.length, 0);

    const dirDenied = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: directorCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["DIRDELDONE"], deleteAck: "УДАЛИТЬ" });
    assert.equal(dirDenied.status, 200);
    assert.equal(dirDenied.body.applied.length, 0);

    const mgrOk = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: managerCookie, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["MGRDELPEND"], deleteAck: "УДАЛИТЬ" });
    assert.equal(mgrOk.status, 200);
    assert.deepEqual(mgrOk.body.applied, ["MGRDELPEND"]);
  });

  it("read-only impersonation cannot delete even as admin preview", async () => {
    await insertTransfer({
      id: "ttadm0000000000000000000000000008",
      code: "ADMPRVW1",
      status: "completed",
      creatorPartyId: managerPartyId,
      holderPartyId: managerPartyId,
      completedAt: "now",
    });
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({ userId: managerUserId });
    assert.equal(start.status, 200, start.text);
    const previewCookies =
      start.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") ?? adminCookie;

    const del = await request(app)
      .post("/api/tan-tracker/registry/cleanup")
      .set({ Origin: ORIGIN, Cookie: previewCookies, "Content-Type": "application/json" })
      .send({ action: "delete", transferIds: ["ADMPRVW1"], deleteAck: "УДАЛИТЬ" });
    assert.equal(del.status, 403, del.text);
    assert.equal(
      (await pool.query(`SELECT 1 FROM tt_transfers WHERE public_code = 'ADMPRVW1'`)).rowCount,
      1,
    );

    await request(app)
      .post("/api/admin/access/preview/stop")
      .set({ Origin: ORIGIN, Cookie: previewCookies })
      .send({});
  });
});
