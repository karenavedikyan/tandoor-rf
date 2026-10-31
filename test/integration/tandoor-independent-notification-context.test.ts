import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { notifyRouteContinued, notifyReturnToCreator } from "../../src/tan-tracker/transfer-lk-notify";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import { buildTanTrackerStaffOutboxMessage } from "../../src/tan-tracker/tan-tracker-outbox-messages";
import type { StaffTransferEventType } from "../../src/tan-tracker/staff-notification-copy";
import { issueHandoffCodeViaBot } from "../../src/tanbot/handoff-code-bot-service";
import { parseHandoffCodePaste } from "../../src/tan-tracker/handoff-code-paste-parse";

const db = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
before(async () => {
  setIntegrationEnv(db, origin);
  process.env.TT_OTP_PEPPER = "independent-notification-context-pepper";
  await prepareDatabase(db);
  await resetPoolForTests();
});
after(closePool);

async function fixture(suffix: string) {
  const pool = getPool()!;
  const parties: string[] = [];
  const users: string[] = [];
  for (const [index, name] of ["Анна Создатель", "Борис Держатель", "Вера Получатель"].entries()) {
    const user = await createTestUser({ databaseUrl: db, email: `ctx-${suffix}-${index}@test.local`,
      password: "StrongPass123!", fullName: name, role: "manager" });
    users.push(user.id);
    parties.push((await ensurePartyForUserOnWrite(pool, user.id, name, null)).id);
  }
  const id = `TT-CONTEXT-${suffix}`;
  const publicCode = `TT-2026-${suffix}`;
  await pool.query(`INSERT INTO tt_transfers
    (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,
     final_recipient_party_id,handoff_version,row_version)
    VALUES($1,$2,'Пакет документов','active',$3,$4,$5,$5,3,1)`,
    [id, publicCode, ...parties]);
  return { pool, parties, users, id, publicCode };
}

function assertRoute(text: string, from: string, to: string) {
  assert.match(text, new RegExp(`От:\\s*${from}`), "current leg sender, not original creator");
  assert.match(text, new RegExp(`Кому:\\s*${to}`), "current leg intended receiver");
}

it("independent context: continued and return snapshots survive later state/name changes in both channels", async () => {
  const f = await fixture("901");
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await notifyRouteContinued(client, { transferId: f.id, publicCode: f.publicCode, itemTitle: "Пакет документов",
      holderPartyId: f.parties[1], newPendingPartyId: f.parties[2], creatorPartyId: f.parties[0], handoffVersion: 3 });
    await client.query("UPDATE tt_transfers SET pending_party_id=$2,handoff_version=4 WHERE id=$1", [f.id, f.parties[0]]);
    await notifyReturnToCreator(client, { transferId: f.id, publicCode: f.publicCode, itemTitle: "Пакет документов",
      holderPartyId: f.parties[1], creatorPartyId: f.parties[0], handoffVersion: 4 });
    await client.query("UPDATE tt_parties SET display_name='Имя изменилось позже' WHERE id=ANY($1::uuid[])", [f.parties]);
    await client.query("UPDATE tt_transfers SET holder_party_id=$2,pending_party_id=NULL WHERE id=$1", [f.id, f.parties[0]]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const rows = (await f.pool.query(`SELECT channel,event_type,payload FROM tanbot_notification_outbox
    WHERE payload->>'transferId'=$1 ORDER BY event_type,channel`, [f.id])).rows;
  assert.equal(rows.filter(r => r.event_type === "tan_tracker.continued").length, 6);
  assert.equal(rows.filter(r => r.event_type === "tan_tracker.returned").length, 4);
  assert.deepEqual([...new Set(rows.map(r => r.channel))].sort(), ["max", "telegram"]);
  for (const row of rows) {
    const text = buildTanTrackerStaffOutboxMessage(row.event_type as StaffTransferEventType, row.payload, origin);
    assert.ok(text.includes(f.publicCode) && text.includes("Пакет документов"));
    assertRoute(text, "Борис Держатель", row.event_type === "tan_tracker.continued" ? "Вера Получатель" : "Анна Создатель");
    assert.doesNotMatch(text, /Имя изменилось позже/);
  }
});

it("independent context: final receipt keeps prior sender after holder mutation", async () => {
  const f = await fixture("902");
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await applyPendingReceiptHandoff(client, { id: f.id, holder_party_id: f.parties[1],
      pending_party_id: f.parties[2], final_recipient_party_id: f.parties[2],
      handoff_version: 3, row_version: 1 }, f.users[1], f.parties[1], "Synthetic receipt");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const state = (await f.pool.query("SELECT holder_party_id,pending_party_id FROM tt_transfers WHERE id=$1", [f.id])).rows[0];
  assert.equal(state.holder_party_id, f.parties[2]);
  assert.equal(state.pending_party_id, null);
  const rows = (await f.pool.query(`SELECT event_type,payload FROM tanbot_notification_outbox
    WHERE payload->>'transferId'=$1 AND event_type='tan_tracker.delivered'`, [f.id])).rows;
  assert.equal(rows.length, 6);
  for (const row of rows) assertRoute(buildTanTrackerStaffOutboxMessage(row.event_type, row.payload, origin),
    "Борис Держатель", "Вера Получатель");
});

it("independent context: actual newly issued code message identifies current leg and roundtrips both clipboard parsers", async () => {
  const f = await fixture("123456");
  const sandbox = { window: {} as { TanTrackerHandoffCodePaste: { parseHandoffCodePaste: typeof parseHandoffCodePaste } } };
  runInNewContext(readFileSync("public/tan-tracker/handoff-code-paste.js", "utf8"), sandbox);
  for (const channel of ["max", "telegram"] as const) {
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN");
      const issued = await issueHandoffCodeViaBot(client, { channel, userId: f.users[2], partyId: f.parties[2],
        transferPublicCode: f.publicCode, expectedHandoffVersion: 3 });
      assert.ok(issued.ok);
      if (!issued.ok) throw new Error(issued.message);
      assertRoute(issued.message, "Борис Держатель", "Вера Получатель");
      assert.ok(issued.message.includes(f.publicCode) && issued.message.includes("Пакет документов"));
      assert.match(issued.code, /^\d{6}$/);
      for (const parse of [parseHandoffCodePaste, sandbox.window.TanTrackerHandoffCodePaste.parseHandoffCodePaste]) {
        const parsed = parse(issued.message);
        assert.ok(parsed.ok);
        if (parsed.ok) assert.equal(parsed.code, issued.code, "never confuse track suffix with OTP");
      }
      await client.query("ROLLBACK");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
});

it("independent context: external recipient's persisted receipt has the completed leg, not new holder twice", async () => {
  const f = await fixture("903");
  const ext = (await f.pool.query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Галина Внешняя','+79994449903') RETURNING id`)).rows[0].id;
  const person = (await f.pool.query(`INSERT INTO tt_external_persons(party_id,display_name,phone_e164)
    VALUES($1,'Галина Внешняя','+79994449903') RETURNING id`, [ext])).rows[0].id;
  for (const channel of ["max", "telegram"]) {
    await f.pool.query(`INSERT INTO tt_external_person_verifications
      (person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,$2,'889903','889903')`, [person, channel]);
  }
  await f.pool.query("UPDATE tt_transfers SET pending_party_id=$2,final_recipient_party_id=$2 WHERE id=$1", [f.id, ext]);
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await applyPendingReceiptHandoff(client, { id: f.id, holder_party_id: f.parties[1],
      pending_party_id: ext, final_recipient_party_id: ext, handoff_version: 3, row_version: 1 },
      f.users[1], f.parties[1], "Synthetic external receipt");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const rows = (await f.pool.query(`SELECT channel,body FROM tt_external_person_message_outbox
    WHERE person_id=$1 AND event_type='external_person.delivered' ORDER BY channel`, [person])).rows;
  assert.equal(rows.length, 2, "legacy no-invitation-proof fallback preserves both verified channels");
  for (const row of rows) {
    assertRoute(row.body, "Борис Держатель", "Галина Внешняя");
    assert.ok(row.body.includes(f.publicCode) && row.body.includes("Пакет документов"));
    assert.match(row.body, /посмотреть историю, передать предмет дальше или вернуть отправителю/);
  }
});
