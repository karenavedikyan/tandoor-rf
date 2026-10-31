import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { notifyRouteContinued, notifyReturnToCreator, notifyTransferAssignment, notifyPendingCancelled, notifyClosed } from "../../src/tan-tracker/transfer-lk-notify";
import { buildNotificationTransferState } from "../../src/tan-tracker/notification-transfer-state";
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
    assert.match(text, new RegExp(`Статус: Ожидает приёма · ${row.event_type === "tan_tracker.continued" ? "Вера Получатель" : "Анна Создатель"}`));
    assert.match(text, /Ответственный: Борис Держатель/);
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
  for (const row of rows) {
    const text = buildTanTrackerStaffOutboxMessage(row.event_type, row.payload, origin);
    assertRoute(text, "Борис Держатель", "Вера Получатель");
    assert.match(text, /Статус: Получение подтверждено\nОтветственный: Вера Получатель/);
    assert.doesNotMatch(text, /Статус: Завершена|Ответственный: Борис Держатель/);
  }
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
      assert.match(issued.message, /Статус: Ожидает приёма · Вера Получатель\nОтветственный: Борис Держатель/);
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
    assert.match(row.body, /Статус: Получение подтверждено\nОтветственный: Галина Внешняя/);
    assert.ok(row.body.includes(f.publicCode) && row.body.includes("Пакет документов"));
    assert.match(row.body, /посмотреть историю, передать предмет дальше или вернуть отправителю/);
  }
});

it("lifecycle: assignment snapshots distinguish pending from confirmed; cancel and close retain actual holder", async () => {
  const f = await fixture("904");
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    const assignment = { transferId: f.id, publicCode: f.publicCode, itemTitle: "Пакет документов",
      holderUserId: f.users[2], holderPartyId: f.parties[2], fromPartyId: f.parties[1], handoffVersion: 3 };
    await notifyTransferAssignment(client, assignment);
    const countsBefore = (await client.query(`SELECT
      (SELECT COUNT(*) FROM tt_handoff_codes WHERE transfer_id=$1) AS codes,
      (SELECT COUNT(*) FROM tt_audit_log WHERE transfer_id=$1) AS audit`, [f.id])).rows[0];
    await client.query("UPDATE tt_transfers SET pending_party_id=NULL WHERE id=$1", [f.id]);
    await notifyPendingCancelled(client, { ...assignment, holderPartyId: f.parties[1],
      revokedPendingPartyId: f.parties[2], creatorPartyId: f.parties[0], handoffVersion: 4 });
    assert.equal((await buildNotificationTransferState(client, f.id))?.phase, "ready",
      "changed holder alone is not canonical proof of receipt");
    await client.query("UPDATE tt_transfers SET holder_party_id=$2,first_custody_at=NOW() WHERE id=$1", [f.id, f.parties[2]]);
    await notifyTransferAssignment(client, { ...assignment, handoffVersion: 5 });
    await notifyPendingCancelled(client, { ...assignment, holderPartyId: f.parties[2],
      revokedPendingPartyId: f.parties[0], creatorPartyId: f.parties[0], handoffVersion: 6 });
    await client.query("UPDATE tt_transfers SET status='completed' WHERE id=$1", [f.id]);
    await notifyClosed(client, { ...assignment, holderPartyId: f.parties[2],
      partyIds: f.parties, handoffVersion: 7 });
    await client.query("UPDATE users SET full_name='Другое имя после события' WHERE id=ANY($1::uuid[])", [f.users]);
    const countsAfter = (await client.query(`SELECT
      (SELECT COUNT(*) FROM tt_handoff_codes WHERE transfer_id=$1) AS codes,
      (SELECT COUNT(*) FROM tt_audit_log WHERE transfer_id=$1) AS audit`, [f.id])).rows[0];
    assert.deepEqual(countsAfter, countsBefore, "notification snapshots neither issue codes nor mutate custody audit");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const rows = (await f.pool.query(`SELECT channel,event_type,payload FROM tanbot_notification_outbox
    WHERE payload->>'transferId'=$1`, [f.id])).rows;
  assert.equal(rows.length, 20);
  for (const channel of ["max", "telegram"]) {
    const messages = rows.filter(row => row.channel === channel).map(row => ({
      event: row.event_type, version: row.payload.handoffVersion,
      text: buildTanTrackerStaffOutboxMessage(row.event_type, row.payload, origin),
    }));
    const at = (version: number) => messages.filter(row => row.version === version);
    assert.match(at(3)[0].text, /Ожидает приёма · Вера Получатель\nОтветственный: Борис Держатель/);
    assert.match(at(3)[0].text, /Получите код приёма/);
    assert.match(at(4)[0].text, /Статус: Ожидает передачи\nОтветственный: Борис Держатель/);
    assert.match(at(5)[0].text, /Получение подтверждено\nОтветственный: Вера Получатель/);
    assert.doesNotMatch(at(5)[0].text, /Получите код приёма/);
    assert.match(at(6)[0].text, /Получение подтверждено\nОтветственный: Вера Получатель/);
    assert.match(at(7)[0].text, /Статус: Завершена\nПоследний держатель: Вера Получатель/);
    for (const row of messages) assert.doesNotMatch(row.text, /Другое имя после события/);
  }
});

it("lifecycle: legacy canonical custody audit restores received status without timestamp; reading is side-effect free", async () => {
  const f = await fixture("905");
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE tt_transfers SET pending_party_id=NULL,first_custody_at=NULL WHERE id=$1", [f.id]);
    assert.equal((await buildNotificationTransferState(client, f.id))?.phase, "ready");
    await client.query(`INSERT INTO tt_audit_log(transfer_id,actor_user_id,acting_party_id,action,detail)
      VALUES($1,$2,$3,'code_verify_ok','{"source":"synthetic-legacy-receipt"}'::jsonb)`, [f.id, f.users[1], f.parties[1]]);
    assert.deepEqual(await buildNotificationTransferState(client, f.id), { phase: "received", holderName: "Борис Держатель" });
    await client.query("UPDATE tt_transfers SET pending_party_id=$2 WHERE id=$1", [f.id, f.parties[2]]);
    assert.deepEqual(await buildNotificationTransferState(client, f.id), {
      phase: "waiting", holderName: "Борис Держатель", pendingName: "Вера Получатель",
    }, "new pending leg takes precedence over prior receipt");
    assert.equal((await client.query("SELECT first_custody_at FROM tt_transfers WHERE id=$1", [f.id])).rows[0].first_custody_at, null);
    assert.equal(await buildNotificationTransferState(client, "NO_SUCH_SYNTHETIC_TRANSFER"), undefined);
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
});
