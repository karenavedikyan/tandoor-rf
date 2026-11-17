import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { PoolClient } from "pg";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  enqueueAutomaticReceiptCode, processAutomaticReceiptCodes, handleAutomaticReceiptCallback,
  automaticReceiptCallback, requestAutomaticReceiptCodeByHolder, type AutomaticReceiptTransport,
} from "../../src/tan-tracker/automatic-receipt-codes";
import { generateHandoffCodeForPendingParty } from "../../src/tan-tracker/handoff-code-generate";
import { issueHandoffCodeViaBot } from "../../src/tanbot/handoff-code-bot-service";
import { verifyPendingReceiptCode } from "../../src/tan-tracker/verify-pending-receipt-code";
import { buildHandoffCodeBotReply } from "../../src/tanbot/handoff-code-bot-flow";
import { buildHandoffGenCallback } from "../../src/tanbot/handoff-code-bot-service";

const db = getIntegrationDatabaseUrl(), pool = () => getPool()!;
const accounts = [
  { channel: "max", userId: "81001", chatId: "82001" },
  { channel: "max", userId: "81002", chatId: "82002" },
  { channel: "telegram", userId: "83001", chatId: "83001" },
  { channel: "telegram", userId: "83002", chatId: "83002" },
] as const;
async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool().connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
describe("one receipt code, independent frozen staff account deliveries", { concurrency: false }, () => {
  let user: string, pending: string, holder: string, id: string, job: string, sequence = 0;
  let messages: Parameters<AutomaticReceiptTransport>[0][];
  const success: AutomaticReceiptTransport = async msg => { messages.push(msg); return { ok: true }; };
  async function run(channel: "max" | "telegram", transport = success) {
    return processAutomaticReceiptCodes(pool(), { channel, deliveryEnabled: true, transport });
  }
  async function runAll(transport = success) { await run("max",transport); await run("telegram",transport); }
  const codes = () => messages.filter(m => /^\d{6}$/.test(m.text));
  async function callback(account: (typeof accounts)[number] = accounts[3]!, customChat?: string) {
    return tx(c => handleAutomaticReceiptCallback(c, { payload: automaticReceiptCallback(job),
      channel: account.channel, userId: BigInt(account.userId), chatId: BigInt(customChat ?? account.chatId) }));
  }
  async function expire() {
    await pool().query("UPDATE tt_handoff_codes SET expires_at=NOW()-interval '1 second' WHERE transfer_id=$1", [id]);
    await pool().query("UPDATE tt_automatic_receipt_codes SET code_expires_at=NOW()-interval '1 second' WHERE id=$1", [job]);
  }
  before(async () => {
    setIntegrationEnv(db); await prepareDatabase(db); await resetPoolForTests();
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
    for (const name of ["MAX","TELEGRAM"]) {
      process.env[`TANBOT_${name}_ENABLED`] = "true";
      process.env[`TANBOT_${name}_DELIVERY_ENABLED`] = "true";
      process.env[`TANBOT_${name}_WEBHOOK_ENABLED`] = "true";
      process.env[`TANBOT_${name}_WEBHOOK_SECRET`] = "synthetic-local-webhook-secret";
      process.env[`TANBOT_${name}_BOT_TOKEN`] = name === "MAX"
        ? "SYNTH_MAX_TEST_TOKEN_0123456789abcdef" : "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
      process.env[`TANBOT_${name}_BOT_USERNAME`] = name === "MAX" ? "id231100522180_bot" : "TANDOOR_IBOT";
      process.env[`TANBOT_${name}_EXPECTED_USERNAME`] = process.env[`TANBOT_${name}_BOT_USERNAME`];
      process.env[`TANBOT_${name}_LINK_TOKEN_PEPPER`] = "synthetic-multi-account-link-pepper";
    }
    user = (await createTestUser({ databaseUrl: db, email: "receipt-multi@test.local",
      password: "SyntheticPass123!", fullName: "Получатель", phone: "+79000000001" })).id;
    const sender = (await createTestUser({ databaseUrl: db, email: "receipt-sender@test.local",
      password: "SyntheticPass123!", fullName: "Отправитель", phone: "+79000000003" })).id;
    await pool().query("UPDATE users SET additional_phone='+79000000002' WHERE id=$1", [user]);
    pending = (await ensurePartyForUserOnWrite(pool(),user,"Получатель","+79000000001")).id;
    holder = (await ensurePartyForUserOnWrite(pool(),sender,"Отправитель","+79000000003")).id;
    for (const [index,a] of accounts.entries()) {
      await pool().query(`INSERT INTO tanbot_${a.channel}_${index % 2 ? "additional_accounts" : "accounts"}
        (user_id,${a.channel}_user_id,${a.channel}_chat_id,phone_e164,notifications_enabled)
        VALUES ($1,$2,$3,$4,TRUE)`, [user,a.userId,a.chatId,index % 2 ? "+79000000002" : "+79000000001"]);
    }
  });
  beforeEach(async () => {
    await pool().query("UPDATE tt_automatic_receipt_codes SET status='cancelled',encrypted_code=NULL");
    for (const channel of ["max","telegram"]) for (const table of ["accounts","additional_accounts"]) {
      await pool().query(`UPDATE tanbot_${channel}_${table} SET notifications_enabled=TRUE,stopped_at=NULL`);
    }
    id = `MULTI-CODE-${++sequence}`; messages = [];
    await pool().query(`INSERT INTO tt_transfers
      (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id,handoff_version)
      VALUES ($1,$1,'Синтетический предмет','waiting',$2,$2,$3,$3,1)`, [id,holder,pending]);
    await tx(c => enqueueAutomaticReceiptCode(c,id));
    job = (await pool().query("SELECT id FROM tt_automatic_receipt_codes WHERE transfer_id=$1", [id])).rows[0].id;
  });
  after(closePool);
  it("four accounts receive exactly one context/code pair and one shared code; repeat ticks send nothing", async () => {
    await tx(c => enqueueAutomaticReceiptCode(c,id));
    await runAll(); await runAll();
    assert.equal(messages.length,8); assert.equal(codes().length,4);
    assert.equal(new Set(codes().map(m => m.text)).size,1);
    assert.deepEqual(codes().map(m => m.userId).sort(),accounts.map(a => a.userId).sort());
    assert.equal((await pool().query("SELECT 1 FROM tt_handoff_codes WHERE transfer_id=$1", [id])).rowCount,1);
    assert.equal((await pool().query("SELECT encrypted_code FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].encrypted_code,null);
  });
  it("failed header retries only its account, even when transport throws", async () => {
    let fail = true;
    const transport: AutomaticReceiptTransport = async msg => {
      if (msg.userId === accounts[1].userId && fail) throw new Error("Synthetic offline");
      return success(msg);
    };
    await runAll(transport); assert.equal(codes().length,3);
    await pool().query("UPDATE tt_automatic_receipt_account_deliveries SET next_attempt_at=NOW() WHERE job_id=$1", [job]);
    fail = false; await runAll(transport); assert.equal(codes().length,4); assert.equal(messages.length,8);
    assert.equal(new Set(codes().map(m => m.text)).size,1);
  });
  it("failed code retry preserves its successful header and never repeats other accounts", async () => {
    let fail = true;
    const transport: AutomaticReceiptTransport = async msg => {
      if (msg.userId === accounts[1].userId && /^\d{6}$/.test(msg.text) && fail)
        return { ok: false, code: "SYNTHETIC_OFFLINE", retryable: true };
      return success(msg);
    };
    await runAll(transport);
    assert.equal(messages.filter(m => m.userId === accounts[1].userId).length,1);
    await pool().query("UPDATE tt_automatic_receipt_account_deliveries SET next_attempt_at=NOW() WHERE job_id=$1", [job]);
    fail = false; await runAll(transport);
    assert.equal(messages.length,8); assert.equal(codes().length,4);
  });
  it("terminal failure does not block the other three accounts", async () => {
    await runAll(async msg => msg.userId === accounts[1].userId
      ? { ok: false, code: "SYNTHETIC_BLOCKED" } : success(msg));
    assert.equal(codes().length,3);
    const rows = (await pool().query("SELECT status FROM tt_automatic_receipt_account_deliveries WHERE job_id=$1", [job])).rows;
    assert.equal(rows.filter(r => r.status === "failed").length,1);
    assert.equal(rows.filter(r => r.status === "sent").length,3);
  });
  it("terminal failed account can retry the SAME live code without repeating the successful accounts", async () => {
    await runAll(async msg => msg.userId === accounts[3].userId
      ? { ok: false, code: "SYNTHETIC_BLOCKED" } : success(msg));
    const original = codes()[0]!.text;
    assert.match((await callback()).text,/только для этого чата/);
    await runAll(); assert.equal(codes().length,4); assert.equal(messages.length,8);
    assert.ok(codes().every(m => m.text === original));
  });
  it("concurrent channels/workers generate one code and cannot duplicate successful sends", async () => {
    await Promise.all([run("max"),run("telegram"),run("max"),run("telegram")]);
    await runAll();
    assert.equal(codes().length,4); assert.equal(messages.length,8);
    assert.equal(new Set(codes().map(m => m.text)).size,1);
    assert.equal((await pool().query("SELECT 1 FROM tt_handoff_codes WHERE transfer_id=$1", [id])).rowCount,1);
  });
  it("disabled and stopped account deliveries are cancelled independently", async () => {
    await pool().query("UPDATE tanbot_max_additional_accounts SET notifications_enabled=FALSE WHERE user_id=$1", [user]);
    await pool().query("UPDATE tanbot_telegram_additional_accounts SET stopped_at=NOW() WHERE user_id=$1", [user]);
    await runAll(); assert.equal(codes().length,2);
    assert.match((await callback()).text,/недоступна/);
    assert.equal((await pool().query(`SELECT 1 FROM tt_automatic_receipt_account_deliveries
      WHERE job_id=$1 AND status='cancelled'`, [job])).rowCount,2);
  });
  it("secondary account callback validates its own account and exact chat", async () => {
    await runAll(); assert.match((await callback()).text,/ещё действует/);
    assert.match((await callback(accounts[3],"99999")).text,/недоступна/);
  });
  it("secondary callback renews the shared code once for all four original accounts", async () => {
    await runAll(); const firstHash = (await pool().query("SELECT code_hash FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].code_hash;
    await expire(); assert.match((await callback()).text,/во все подключённые/);
    await Promise.all([callback(),callback()]);
    assert.equal((await pool().query("SELECT generation FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].generation,2);
    messages = []; await runAll(); assert.equal(codes().length,4);
    assert.equal(new Set(codes().map(m => m.text)).size,1);
    const nextHash = (await pool().query("SELECT code_hash FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].code_hash;
    assert.notEqual(nextHash,firstHash);
    assert.equal((await pool().query(`SELECT 1 FROM tt_handoff_codes WHERE transfer_id=$1
      AND consumed_at IS NULL AND expires_at>NOW()`, [id])).rowCount,1);
  });
  it("renewal still reaches other accounts after the original selected account stops", async () => {
    await runAll(); await expire();
    await pool().query("UPDATE tanbot_max_accounts SET stopped_at=NOW() WHERE user_id=$1", [user]);
    assert.equal(await tx(c => requestAutomaticReceiptCodeByHolder(c, {
      transferId:id, holderPartyId:holder, handoffVersion:1, channel:"max",
    })),"queued");
    messages = []; await runAll(); assert.equal(codes().length,3);
  });
  for (const reason of ["stale","consumed","expired","replaced"] as const) {
    it(`${reason} code is not sent to remaining accounts`, async () => {
      await run("max"); messages = [];
      if (reason === "stale") await pool().query("UPDATE tt_transfers SET handoff_version=2 WHERE id=$1", [id]);
      if (reason === "consumed") await pool().query("UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE transfer_id=$1", [id]);
      if (reason === "expired") await expire();
      if (reason === "replaced") await tx(c => generateHandoffCodeForPendingParty(c, {
        transferIdOrCode:id,pendingPartyId:pending,auditUserId:user,auditPartyId:pending,notifyHolder:false,
      }));
      await run("telegram"); assert.equal(messages.length,0);
      assert.equal((await pool().query("SELECT status FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].status,"cancelled");
    });
  }
  it("legacy parent-only jobs retain their original single-target semantics", async () => {
    await pool().query("DELETE FROM tt_automatic_receipt_account_deliveries WHERE job_id=$1", [job]);
    await runAll(); assert.equal(codes().length,1); assert.equal(messages.length,2);
  });
  it("new bindings never receive an already-queued code or its renewal", async () => {
    await pool().query("UPDATE tanbot_max_additional_accounts SET max_user_id=81999,max_chat_id=82999 WHERE user_id=$1", [user]);
    await runAll(); assert.equal(codes().length,3);
    assert.ok(messages.every(m => m.userId !== "81999"));
    await expire(); await callback(); messages = []; await runAll();
    assert.equal(codes().length,3); assert.ok(messages.every(m => m.userId !== "81999"));
    await pool().query("UPDATE tanbot_max_additional_accounts SET max_user_id=81002,max_chat_id=82002 WHERE user_id=$1", [user]);
  });
  for (const entry of ["LK","bot"] as const) {
    it(`explicit ${entry} issuance sends the returned code to every account, superseding queued older code`, async () => {
      await run("max");
      const oldEpoch = (await pool().query("SELECT delivery_epoch FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].delivery_epoch;
      const issued = await tx(c => entry === "LK"
        ? generateHandoffCodeForPendingParty(c, { transferIdOrCode:id,pendingPartyId:pending,
          auditUserId:user,auditPartyId:pending })
        : issueHandoffCodeViaBot(c, { channel:"telegram",userId:user,partyId:pending,
          transferPublicCode:id,expectedHandoffVersion:1 }));
      assert.ok(issued.ok); messages = []; await runAll();
      assert.equal(codes().length,4); assert.ok(codes().every(m => m.text === issued.code));
      assert.equal(messages.length,8);
      const current = (await pool().query("SELECT delivery_epoch FROM tt_automatic_receipt_codes WHERE id=$1", [job])).rows[0].delivery_epoch;
      assert.notEqual(current,oldEpoch);
      assert.equal((await pool().query(`SELECT 1 FROM tt_automatic_receipt_account_deliveries
        WHERE job_id=$1 AND delivery_epoch=$2 AND status='cancelled'`, [job,oldEpoch])).rowCount,2);
      assert.equal((await pool().query(`SELECT 1 FROM tt_handoff_codes WHERE transfer_id=$1
        AND consumed_at IS NULL AND expires_at>NOW()`, [id])).rowCount,1);
    });
  }
  it("receipt is confirmed exactly once even though all four accounts hold the code", async () => {
    await runAll();
    const code = codes()[0]!.text;
    const first = await tx(async c => {
      const row = (await c.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [id])).rows[0];
      return verifyPendingReceiptCode(c, { row,code,auditUserId:null,actingPartyId:holder });
    });
    assert.equal(first.ok,true);
    const second = await tx(async c => {
      const row = (await c.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [id])).rows[0];
      return verifyPendingReceiptCode(c, { row,code,auditUserId:null,actingPartyId:holder });
    });
    assert.equal(second.ok,false);
    assert.equal((await pool().query("SELECT 1 FROM tt_audit_log WHERE transfer_id=$1 AND action='code_verify_ok'", [id])).rowCount,1);
    assert.match((await callback()).text,/недоступна/);
  });
  it("manual secondary-bot request acknowledges the queue without sending an extra untracked code pair", async () => {
    const reply = await tx(c => buildHandoffCodeBotReply(c,"telegram", {
      externalUserId:BigInt(accounts[3].userId),callbackPayload:buildHandoffGenCallback(id,1),
    }));
    assert.match(reply.text,/Код поставлен в очередь/);
    assert.equal(reply.copyOnlyCode,undefined);
    await runAll(); assert.equal(messages.length,8); assert.equal(codes().length,4);
  });
});
