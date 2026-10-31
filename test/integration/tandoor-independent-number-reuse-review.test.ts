import test from "node:test";
import assert from "node:assert/strict";
import {
  getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser,
} from "../helpers/test-db";
import { requirePool, closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite, nextPublicTransferCode } from "../../src/tan-tracker/repository";
import { deleteTransferBeforeFirstCustody } from "../../src/tan-tracker/registry-cleanup/delete-transfer";
import { notifyExternalPartyAfterHandoff } from "../../src/tan-tracker/transfer-external-messenger-notify";
import { runTanbotMaxOutboxWorkerOnce } from "../../src/tanbot-max/outbox-scheduler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";

test("independent: delete/recreate cannot reuse IDs, suppress notices, or send old capabilities", async () => {
  const db = getIntegrationDatabaseUrl();
  setIntegrationEnv(db, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TANBOT_MAX_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "true",
    TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TOKEN_FOR_TEST_ONLY_1234567890",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-link-pepper-min-16-chars",
    TANBOT_MAX_BOT_USERNAME: "synthetic_max_bot",
    TANBOT_MAX_WEBHOOK_ENABLED: "false",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  const admin = await createTestUser({
    databaseUrl: db, email: "independent-number@test.local",
    password: "StrongPass123!", fullName: "Synthetic Admin", role: "admin",
  });
  const pool = requirePool();
  try {
    const c = await pool.connect();
    let actorParty = "", person = "", externalParty = "";
    try {
      actorParty = (await ensurePartyForUserOnWrite(c, admin.id, "Synthetic Admin", null)).id;
      externalParty = (await c.query(
        `INSERT INTO tt_parties(kind,display_name,phone_e164)
         VALUES('external','Synthetic recipient','+79990000222') RETURNING id`,
      )).rows[0].id;
      person = (await c.query(
        `INSERT INTO tt_external_persons(party_id,display_name,phone_e164)
         VALUES($1,'Synthetic recipient','+79990000222') RETURNING id`, [externalParty],
      )).rows[0].id;
      await c.query(
        `INSERT INTO tt_external_person_verifications
         (person_id,channel,messenger_user_id,messenger_chat_id,notifications_enabled)
         VALUES($1,'max','9191001','-9192002',TRUE)`, [person],
      );
    } finally { c.release(); }
    const config = loadTanbotMaxStage2Config();
    assert.ok(config.ok);
    if (!config.ok) return;

    for (const priorStatus of ["failed", "sent", "cancelled"]) {
      const client = await pool.connect();
      let oldId = "", newId = "";
      try {
        await client.query("BEGIN");
        oldId = await nextPublicTransferCode(client);
        const insertDelivered = async (id: string) => {
          await client.query(
            `INSERT INTO tt_transfers
             (id,public_code,item_title,status,creator_party_id,holder_party_id,
              final_recipient_party_id,handoff_version,first_custody_at)
             VALUES($1,$1,'Synthetic parcel','delivered',$2,$3,$3,2,NOW())`,
            [id, actorParty, externalParty],
          );
        };
        await insertDelivered(oldId);
        await client.query(
          `INSERT INTO tt_external_person_message_outbox
           (person_id,channel,messenger_chat_id,body,idempotency_key,event_type,status,attempt_count,next_attempt_at)
           VALUES($1,'max','-9192002','OLD_CAPABILITY_MUST_NOT_SEND',$2,'external_person.delivered',$3,1,NOW())`,
          [person, `tt-ext-msg:delivered:${oldId}:hv:2:max`, priorStatus],
        );
        assert.equal((await deleteTransferBeforeFirstCustody(
          client, oldId, { userId: admin.id, partyId: actorParty }, { adminForceDelete: true },
        )).ok, true);
        newId = await nextPublicTransferCode(client);
        assert.notEqual(newId, oldId, "Deleted public/internal identity must never be recycled");
        await insertDelivered(newId);
        for (let repeat = 0; repeat < 2; repeat++) {
          await notifyExternalPartyAfterHandoff(client, {
            externalPartyId: externalParty, transferId: newId,
            handoffVersion: 2, event: "delivered", preferredChannel: "max", singleChannel: true,
          });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      const calls: Array<{ userId: bigint; text: string }> = [];
      await runTanbotMaxOutboxWorkerOnce(pool, config.config, async (input) => {
        calls.push({ userId: input.userId, text: input.text });
        return { ok: true, result: { message: { mid: "synthetic-message-only" } } };
      });
      assert.equal(calls.length, 1, "Only one current notice, no historical retries");
      assert.equal(calls[0]!.userId, 9191001n);
      assert.ok(calls[0]!.text.includes(newId));
      assert.ok(!calls[0]!.text.includes(oldId));
      assert.ok(!calls[0]!.text.includes("OLD_CAPABILITY"));
      const rows = (await pool.query(
        `SELECT status,attempt_count FROM tt_external_person_message_outbox WHERE idempotency_key=$1`,
        [`tt-ext-msg:delivered:${newId}:hv:2:max`],
      )).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "sent");
      assert.equal(rows[0].attempt_count, 1);
      assert.equal((await pool.query(`SELECT 1 FROM tt_transfers WHERE id=$1`, [oldId])).rowCount, 0);
      assert.equal((await pool.query(
        `SELECT status FROM tt_external_person_message_outbox WHERE idempotency_key=$1`,
        [`tt-ext-msg:delivered:${oldId}:hv:2:max`],
      )).rows[0].status, priorStatus);
    }
  } finally { await closePool(); }
});
