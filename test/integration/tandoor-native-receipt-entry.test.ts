import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import type { Express } from "express";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { getPool, resetPoolForTests, closePool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import { requireHandoffOtpPepper, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS } from "../../src/tan-tracker/otp-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildReceiptEntryCallback, parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { buildTrackStatusCallback, parseTrackStatusCallback } from "../../src/tanbot/track-status-callback";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../../src/tanbot/native-create/menu-sentinel";
import { trackStatusReply } from "../../src/tanbot/native-create/track-status";
import { withTransaction } from "../../src/access/db";
import { markPendingObsoleteInTransaction } from "../../src/tan-tracker/pending-obsolete-mutation";
import { assignPendingRecipientInTransaction } from "../../src/tan-tracker/pending-mutations";
import { completeTransferMutation } from "../../src/tan-tracker/legacy-complete-mutation";
import { verifyPendingReceiptCode } from "../../src/tan-tracker/verify-pending-receipt-code";
import { TELEGRAM_KEYBOARD_AUX_TEXT } from "../../src/tanbot/native-create/telegram-reply-markup";
import { tryNativeCreateMaxCallback, tryNativeCreateTelegramCallback } from "../../src/tanbot/native-create/adapters";
import { mintExternalMessengerSession, bindSessionMessengerChat, type ExternalMessengerSessionRow } from "../../src/tan-tracker/external-messenger/session-service";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";
import { nativeBotDraftChatKey } from "../../src/tanbot/native-create/draft-scope";
import { linkStaffByVerifiedContact } from "../../src/tanbot/verified-contact-staff-link";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chat: number; party: string; user?: string };
type Button = { text: string; payload?: string; callback_data?: string; url?: string };
type Reply = { text: string; buttons: Button[]; messages?: Reply[] };
let app: Express, seq = 530000, originalFetch: typeof fetch, networkCalls = 0;
const db = getIntegrationDatabaseUrl();
const code = "345678";
const p = () => getPool()!;
async function unlinkedStaff(channel: Channel, status = "active") {
  const id = ++seq, phone = `+7987${String(id).padStart(7, "0")}`;
  const user = await createTestUser({ databaseUrl: db, email: `own-contact-${id}@test.local`,
    password: "SyntheticPass123!", fullName: "Synthetic contact owner", role: "manager", status, phone });
  const a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id, party: "", user: user.id };
  return { a, phone, user: user.id };
}
async function identitySnapshot() {
  return (await p().query(`SELECT jsonb_build_object(
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u),
    'sessions',(SELECT COUNT(*) FROM sessions),
    'externalSessions',(SELECT COUNT(*) FROM tt_external_person_sessions),
    'persons',(SELECT COUNT(*) FROM tt_external_persons),
    'verifications',(SELECT COUNT(*) FROM tt_external_person_verifications),
    'parties',(SELECT COUNT(*) FROM tt_parties),
    'transfers',(SELECT COUNT(*) FROM tt_transfers)) AS value`)).rows[0].value;
}
async function ownContactLink(a: Actor, phone: string) {
  return withTransaction(client => linkStaffByVerifiedContact(client, {
    channel: a.channel, messengerUserId: BigInt(a.id), messengerChatId: BigInt(a.chat), phoneRaw: phone,
  }));
}
async function actor(channel: Channel, staff = true): Promise<Actor> {
  const id = ++seq, chat = channel === "max" ? id + 100000 : id;
  if (staff) {
    const user = await createTestUser({ databaseUrl: db, email: `receipt-${id}@test.local`,
      password: "SyntheticPass123!", fullName: "Synthetic sender", role: "admin" });
    const party = await ensurePartyForUserOnWrite(p(), user.id, "Synthetic sender", null);
    const prefix = channel === "max" ? "max" : "telegram";
    await p().query(`INSERT INTO tanbot_${prefix}_accounts(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`, [user.id, String(id), String(chat)]);
    return { channel, id, chat, party: party.id, user: user.id };
  }
  const phone = `+7999${String(id).padStart(7,"0")}`;
  const party = (await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic sender',$1) RETURNING id`, [phone])).rows[0].id;
  const person = randomUUID();
  await p().query(`INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164)
    VALUES($1,$2,'Synthetic sender',$3)`, [person, party, phone]);
  await p().query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [person, channel, String(id), String(chat)]);
  return { channel, id, chat, party };
}
async function seed(a: Actor) {
  const id = `TT-2026-${++seq}`;
  const recipient = (await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
    VALUES('external','Synthetic recipient',$1) RETURNING id`, [`+7999${String(seq).padStart(7,"0")}`])).rows[0].id;
  await p().query(`INSERT INTO tt_transfers
    (id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id)
    VALUES($1,$1,'Synthetic receipt item','waiting',$2,$2,$3,$3)`, [id, a.party, recipient]);
  await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
    VALUES($1,1,$2,$3,NOW()+INTERVAL '30 minutes')`, [id, recipient, hashOtp(code, requireHandoffOtpPepper())]);
  return {
    id,
    recipient,
    pick: buildReceiptEntryCallback("pick", id, 1)!,
    callback: buildReceiptEntryCallback("code", id, 1)!,
  };
}
async function seedReceived(a: Actor, finalHolder = true) {
  const t = await seed(a);
  await p().query(`UPDATE tt_transfers SET creator_party_id=$2, pending_party_id=NULL,
    final_recipient_party_id=$3, status='delivered', first_custody_at=NOW() WHERE id=$1`,
    [t.id, t.recipient, finalHolder ? a.party : t.recipient]);
  return t;
}
async function seedClosed(a: Actor, status: "completed" | "obsolete" = "completed") {
  const t = await seedReceived(a);
  await p().query(`UPDATE tt_transfers SET status=$2,
    completed_at=CASE WHEN $2='completed' THEN NOW() ELSE NULL END WHERE id=$1`, [t.id, status]);
  return t;
}
function button(reply: Reply, text: string): string {
  const b = reply.buttons.find(b => b.text === text);
  assert.ok(b, `Missing ${text}: ${JSON.stringify(reply)}`);
  return b.payload ?? b.callback_data!;
}
async function selectForwardRecipient(a: Actor, initial: Reply, replace = false) {
  assert.match(initial.text, replace ? /Изменить получателя/ : /Передать дальше/);
  const phone = `+7988${String(++seq).padStart(7, "0")}`;
  let reply = await send(a, phone);
  for (let i = 0; i < 4 && !reply.buttons.some(b => b.text === (replace ? "Подтвердить замену" : "Передать дальше")); i++) {
    const next = reply.buttons.find(b => b.text === "Далее");
    reply = next ? await send(a, "", next.payload ?? next.callback_data)
      : await send(a, "Synthetic next recipient");
  }
  assert.match(reply.text, /Продолжится (?:этот|тот) же трек/);
  assert.doesNotMatch(reply.text, /Создать передачу|Выберите срок/);
  return { summary: reply, phone };
}
async function pickTransferAndEnterCode(a: Actor, t: { id: string; pick: string }): Promise<Reply> {
  const menu = await send(a, "Мои передачи");
  assert.ok(menu.buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
  const detail = await send(a, "", t.pick);
  assert.match(detail.text, new RegExp(t.id));
  assert.equal((await entries(a)).length, 0, "pick must not create receipt code entry");
  const codeBtn = detail.buttons.find(b => /Ввести код/u.test(b.text));
  assert.ok(codeBtn, JSON.stringify(detail));
  return send(a, "", codeBtn!.payload ?? codeBtn!.callback_data!);
}
async function send(a: Actor, text = "", callback?: string, fixedId?: number, privateDialog = true,
  contact?: { phone: string; ownerId?: number; omitOwner?: boolean; forwarded?: boolean; badSignature?: boolean }): Promise<Reply> {
  const id = fixedId ?? ++seq, replies: Reply[] = [];
  if (a.channel === "telegram") {
    const message = { message_id: id, chat: { id: a.chat, type: privateDialog ? "private" : "group" } };
    const r = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send(callback ? { update_id: id, callback_query: { id: `receipt-${id}`, from: { id: a.id, is_bot: false },
        data: callback, message } } : { update_id: id, message: {
          ...message, from: { id: a.id, is_bot: false },
          ...(contact?.forwarded ? { forward_date: 1, forward_from: { id: a.id + 1 } } : {}),
          ...(contact ? { contact: { phone_number: contact.phone, first_name: "Synthetic own contact",
            ...(contact.omitOwner ? {} : { user_id: contact.ownerId ?? a.id }) } } : { text }),
        } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredTelegramWebhookReplies(p(), cfg.config, async input => {
      if (input.method === "sendMessage") {
        const markup = input.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        replies.push({ text: String(input.body.text), buttons: (markup?.inline_keyboard ?? markup?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  } else {
    const vcf = contact ? ["BEGIN:VCARD", "VERSION:3.0", "FN:Synthetic own contact",
      `TEL;TYPE=CELL:${contact.phone}`, "END:VCARD"].join("\\r\\n") : "";
    const message = { recipient: { chat_id: a.chat, chat_type: privateDialog ? "dialog" : "chat", user_id: a.id },
      ...(contact?.forwarded ? { link: { type: "forward" } } : {}),
      body: { mid: `receipt-${id}`, ...(contact ? { attachments: [{ type: "contact", payload: {
        vcf_info: vcf, max_info: contact.omitOwner ? {} : { user_id: contact.ownerId ?? a.id },
        hash: contact.badSignature ? "0".repeat(64) : createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!)
          .update(decodeVcfInfoForHmac(vcf), "utf8").digest("hex"),
      } }] } : { text }) } };
    const r = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send(callback ? { update_type: "message_callback", timestamp: id, message,
        callback: { callback_id: `receipt-${id}`, payload: callback, user: { user_id: a.id, is_bot: false } } }
        : { update_type: "message_created", timestamp: id, message: { ...message, sender: { user_id: a.id, is_bot: false } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredMaxWebhookReplies(p(), cfg.config, async input => {
      replies.push({ text: input.text, buttons: (input.inlineButtons ?? []).flat() });
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
  }
  const visible =
    a.channel === "telegram"
      ? replies.filter(r => r.text !== TELEGRAM_KEYBOARD_AUX_TEXT)
      : replies;
  return { ...(visible.at(-1) ?? { text: "", buttons: [] }), messages: visible };
}
async function state(id: string) {
  return (await p().query(`SELECT holder_party_id,pending_party_id,handoff_version,status,
    (SELECT COUNT(*)::int FROM tt_audit_log WHERE transfer_id=$1 AND action='code_verify_ok') AS successes,
    (SELECT verify_attempt_count FROM tt_handoff_codes WHERE transfer_id=$1 ORDER BY created_at DESC LIMIT 1) AS attempts
    FROM tt_transfers WHERE id=$1`, [id])).rows[0];
}
async function entries(a: Actor) {
  return (await p().query(`SELECT * FROM tt_bot_receipt_code_entries WHERE channel=$1 AND messenger_chat_id=$2`,
    [a.channel, String(a.chat)])).rows;
}
const statusView = (id: string) => buildTrackStatusCallback({ action: "view", transferId: id })!;
async function pendingBusinessSnapshot(id: string) {
  const { drafts: _drafts, ...business } = await statusBusinessSnapshot(id);
  return business;
}
async function statusBusinessSnapshot(id: string) {
  return (await p().query(`SELECT jsonb_build_object(
    'transfer',(SELECT to_jsonb(t) FROM tt_transfers t WHERE id=$1),
    'codes',(SELECT count(*) FROM tt_handoff_codes WHERE transfer_id=$1),
    'automatic',(SELECT count(*) FROM tt_automatic_receipt_codes WHERE transfer_id=$1),
    'invitations',(SELECT count(*) FROM tt_transfer_invitations WHERE transfer_id=$1),
    'timeline',(SELECT count(*) FROM tt_transfer_timeline WHERE transfer_id=$1),
    'audit',(SELECT count(*) FROM tt_audit_log WHERE transfer_id=$1),
    'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM tt_external_request_drafts d),
    'externalOutbox',(SELECT count(*) FROM tt_external_person_message_outbox)
  ) AS snapshot`, [id])).rows[0].snapshot;
}
describe("native receipt confirmation via actual MAX and Telegram webhooks", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(db, "http://127.0.0.1:3000");
    Object.assign(process.env, {
      TT_OTP_PEPPER: "synthetic-native-receipt-pepper-min16", TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-token-0123456789", TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min16", TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret-min16",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_MAX_TOKEN_0123456789abcdef", TANBOT_MAX_BOT_USERNAME: "synthetic_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-min16", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-webhook-secret-min16",
    });
    await prepareDatabase(db); await resetPoolForTests();
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { networkCalls++; throw new Error("Real network forbidden"); };
    app = (await import("../../src/server")).createApp();
  });
  after(async () => { globalThis.fetch = originalFetch; await closePool(); assert.equal(networkCalls, 0); });
  it("both channels: staff own contacts reuse one LK user and party without granting browser sessions", async () => {
    const { a: max, phone, user } = await unlinkedStaff("max");
    const party = await ensurePartyForUserOnWrite(p(), user, "Synthetic multi-channel owner", phone);
    const telegram: Actor = { ...max, channel: "telegram", id: ++seq, chat: seq };
    const before = await identitySnapshot();
    for (const a of [max, telegram]) {
      assert.match((await send(a, "", undefined, undefined, true, { phone })).text, /Номер подтверждён/);
      assert.deepEqual((await p().query(`SELECT user_id::text FROM tanbot_${a.channel}_accounts
        WHERE ${a.channel}_user_id=$1`, [String(a.id)])).rows, [{ user_id: user }]);
    }
    assert.deepEqual(await identitySnapshot(), before);
    assert.deepEqual((await p().query(`SELECT id::text FROM tt_parties WHERE kind='user' AND user_id=$1`,
      [user])).rows, [{ id: party.id }]);
  });
  it("both channels: external own contacts reuse the same canonical person and party", async () => {
    const id = ++seq, phone = `+7987${String(id).padStart(7, "0")}`;
    const max: Actor = { channel: "max", id, chat: id + 100000, party: "" };
    const telegram: Actor = { ...max, channel: "telegram", id: ++seq, chat: seq };
    for (const a of [max, telegram]) {
      assert.match((await send(a, "", undefined, undefined, true, { phone })).text, /Номер подтверждён/);
    }
    const identities = (await p().query(`SELECT v.channel,p.id::text,p.party_id::text FROM tt_external_person_verifications v
      JOIN tt_external_persons p ON p.id=v.person_id WHERE p.phone_e164=$1 ORDER BY v.channel`, [phone])).rows;
    assert.equal(identities.length, 2);
    assert.deepEqual(identities.map(x => x.channel), ["max", "telegram"]);
    assert.equal(identities[0].id, identities[1].id);
    assert.equal(identities[0].party_id, identities[1].party_id);
    assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_parties WHERE phone_e164=$1`, [phone])).rows[0].n, 1);
  });
  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: an existing external messenger identity cannot be upgraded into a staff account by contact sharing`, async () => {
      const external = await actor(channel, false), staff = await unlinkedStaff(channel);
      const bound = { ...staff.a, id: external.id, chat: external.chat };
      const before = await identitySnapshot();
      assert.equal((await ownContactLink(bound, staff.phone)).kind, "rejected");
      await send(bound, "", undefined, undefined, true, { phone: staff.phone });
      assert.deepEqual(await identitySnapshot(), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_accounts
        WHERE user_id=$1`, [staff.user])).rows[0].n, 0);
      assert.equal((await p().query(`SELECT p.party_id FROM tt_external_person_verifications v
        JOIN tt_external_persons p ON p.id=v.person_id WHERE channel=$1 AND messenger_user_id=$2`,
        [channel, String(external.id)])).rows[0].party_id, external.party);
    });
    it(`${channel}: revoking staff role/status after own-contact confirmation still denies creation`, async () => {
      const { a, phone, user } = await unlinkedStaff(channel);
      await send(a, "", undefined, undefined, true, { phone });
      await p().query(`UPDATE users SET role='marketer' WHERE id=$1`, [user]);
      const before = await identitySnapshot();
      const denied = await send(a, "Создать передачу");
      assert.match(denied.text, /недоступ|запрещ/i);
      assert.deepEqual(await identitySnapshot(), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_request_drafts
        WHERE payload->>'staffUserId'=$1`, [user])).rows[0].n, 0);
      await p().query(`UPDATE users SET role='manager',status='disabled' WHERE id=$1`, [user]);
      const disabledBefore = await identitySnapshot();
      const disabled = await send(a, "Создать передачу");
      assert.match(disabled.text, /недоступ|запрещ/i);
      assert.deepEqual(await identitySnapshot(), disabledBefore);
    });
    it(`${channel}: staff authentication requires a private provider-owned contact, not typed/forwarded/foreign data`, async () => {
      const { a, phone } = await unlinkedStaff(channel);
      const before = await identitySnapshot();
      await send(a, phone);
      for (const contact of [{ phone, ownerId: a.id + 1 }, { phone, omitOwner: true },
        { phone, forwarded: true }, ...(channel === "max" ? [{ phone, badSignature: true }] : [])]) {
        const r = await send(a, "", undefined, undefined, true, contact);
        assert.doesNotMatch(r.text, /Номер подтверждён/);
      }
      await send(a, "", undefined, undefined, false, { phone });
      if (channel === "telegram") {
        await send({ ...a, chat: a.chat + 1 }, "", undefined, undefined, true, { phone });
      }
      assert.deepEqual(await identitySnapshot(), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_accounts
        WHERE user_id=$1`, [a.user])).rows[0].n, 0);
      assert.match((await send(a, "", undefined, undefined, true, { phone })).text, /Номер подтверждён/);
      assert.deepEqual(await identitySnapshot(), before, "only a binding/audit may change, not auth data or business identities");
    });
    for (const problem of ["duplicate-staff", "disabled", "invited", "stale-alias", "null-phone-alias",
      "external-party", "other-active-binding", "other-stopped-binding", "reserved-stopped-messenger",
      "different-chat"] as const) {
      it(`${channel}: ${problem} cannot silently select, replace or merge an identity`, async () => {
        const { a, phone, user } = await unlinkedStaff(channel,
          problem === "disabled" || problem === "invited" ? problem : "active");
        if (problem === "duplicate-staff") {
          await createTestUser({ databaseUrl: db, email: `duplicate-${a.id}@test.local`,
            password: "SyntheticPass123!", fullName: "Synthetic duplicate", phone });
        }
        if (problem === "stale-alias" || problem === "null-phone-alias") {
          await ensurePartyForUserOnWrite(p(), user, "Synthetic old alias", phone);
          await p().query(`UPDATE users SET phone=$2 WHERE id=$1`, [user,
            problem === "null-phone-alias" ? null : `+7986${String(a.id).padStart(7, "0")}`]);
        }
        if (problem === "external-party") {
          await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
            VALUES('external','Synthetic conflicting identity',$1)`, [phone]);
        }
        if (["other-active-binding", "other-stopped-binding", "different-chat"].includes(problem)) {
          await p().query(`INSERT INTO tanbot_${channel}_accounts
            (user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled,stopped_at)
            VALUES($1,$2,$3,FALSE,$4)`, [user, String(problem === "different-chat" ? a.id : a.id + 10000000),
            String(a.chat + 10000000), problem === "other-stopped-binding" ? new Date() : null]);
        }
        if (problem === "reserved-stopped-messenger") {
          const owner = await unlinkedStaff(channel);
          await p().query(`INSERT INTO tanbot_${channel}_accounts
            (user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled,stopped_at)
            VALUES($1,$2,$3,FALSE,NOW())`, [owner.user, String(a.id), String(a.chat)]);
        }
        const before = await identitySnapshot();
        const bindings = async () => (await p().query(`SELECT * FROM tanbot_${channel}_accounts ORDER BY user_id`)).rows;
        const previousBindings = await bindings();
        await send(a, "", undefined, undefined, true, { phone });
        assert.deepEqual(await identitySnapshot(), before);
        assert.deepEqual(await bindings(), previousBindings);
        // Service contract also refuses a conflicting active messenger/chat even
        // where the webhook correctly stays in an already-authenticated context.
        const result = await ownContactLink(a, phone);
        assert.equal(result.kind, "rejected");
        if (result.kind === "rejected") {
          for (const privateValue of [phone, user, "@test.local"]) {
            assert.ok(!result.text.includes(privateValue), "rejection cannot disclose identity details");
          }
        }
      });
    }
    it(`${channel}: confirmation cancels stale LK tokens, is replay-safe and preserves active notification preferences`, async () => {
      const { a, phone, user } = await unlinkedStaff(channel);
      await p().query(`INSERT INTO tanbot_${channel}_link_attempts(user_id,token_hash,expires_at)
        VALUES($1,$2,NOW()+INTERVAL '1 hour')`, [user, randomUUID()]);
      const before = await identitySnapshot(), event = ++seq;
      const first = await send(a, "", undefined, event, true, { phone });
      assert.match(first.text, /Номер подтверждён/);
      await send(a, "", undefined, event, true, { phone });
      await p().query(`UPDATE tanbot_${channel}_accounts SET notifications_enabled=FALSE WHERE user_id=$1`, [user]);
      const repeat = await send(a, "", undefined, undefined, true, { phone });
      assert.doesNotMatch(repeat.text, /Контакт не принят|Используйте личный кабинет|Подключить/);
      assert.equal((await ownContactLink(a, phone)).kind, "staff");
      assert.equal((await p().query(`SELECT notifications_enabled FROM tanbot_${channel}_accounts
        WHERE user_id=$1`, [user])).rows[0].notifications_enabled, false);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_link_audit
        WHERE user_id=$1 AND action='own_contact_link'`, [user])).rows[0].n, 1);
      assert.ok((await p().query(`SELECT cancelled_at FROM tanbot_${channel}_link_attempts
        WHERE user_id=$1`, [user])).rows[0].cancelled_at);
      assert.deepEqual(await identitySnapshot(), before);
    });
    it(`${channel}: stop can be resumed by the same own contact, never as a shadow external profile`, async () => {
      const { a, phone, user } = await unlinkedStaff(channel);
      await send(a, "", undefined, undefined, true, { phone });
      const before = await identitySnapshot();
      const stopped = await send(a, "/stop");
      assert.doesNotMatch(stopped.text, /заново подключите.*(?:ЛК|личном кабинете)/i);
      assert.ok((await p().query(`SELECT stopped_at FROM tanbot_${channel}_accounts WHERE user_id=$1`, [user])).rows[0].stopped_at);
      assert.match((await send(a, "", undefined, undefined, true, { phone })).text, /Номер подтверждён/);
      const account = (await p().query(`SELECT stopped_at,notifications_enabled FROM tanbot_${channel}_accounts
        WHERE user_id=$1`, [user])).rows[0];
      assert.deepEqual(account, { stopped_at: null, notifications_enabled: true });
      assert.deepEqual(await identitySnapshot(), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_link_audit
        WHERE user_id=$1 AND action='own_contact_link'`, [user])).rows[0].n, 2);
    });
    it(`${channel}: concurrent confirmations serialize and cannot replace the winning binding`, async () => {
      const { a, phone, user } = await unlinkedStaff(channel);
      const same = await Promise.all([ownContactLink(a, phone), ownContactLink(a, phone)]);
      assert.deepEqual(same.map(x => x.kind), ["staff", "staff"]);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_link_audit
        WHERE user_id=$1 AND action='own_contact_link'`, [user])).rows[0].n, 1);
      const second = await unlinkedStaff(channel);
      const other = { ...second.a, id: second.a.id + 20000000, chat: second.a.chat + 20000000 };
      const different = await Promise.all([ownContactLink(second.a, second.phone), ownContactLink(other, second.phone)]);
      assert.deepEqual(different.map(x => x.kind).sort(), ["rejected", "staff"]);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tanbot_${channel}_accounts
        WHERE user_id=$1`, [second.user])).rows[0].n, 1);
      const third = await unlinkedStaff(channel), fourth = await unlinkedStaff(channel);
      const oneMessenger = { ...fourth.a, id: third.a.id, chat: third.a.chat };
      const owners = await Promise.all([ownContactLink(third.a, third.phone), ownContactLink(oneMessenger, fourth.phone)]);
      assert.deepEqual(owners.map(x => x.kind).sort(), ["rejected", "staff"],
        "one messenger cannot race its way into two staff accounts");
    });
    for (const format of ["national", "ten-digits"] as const) {
      it(`${channel}: ${format} provider-owned phone normalizes to the existing canonical staff number`, async () => {
        const { a, phone } = await unlinkedStaff(channel);
        const raw = format === "national" ? `8${phone.slice(2)}` : phone.slice(2);
        assert.match((await send(a, "", undefined, undefined, true, { phone: raw })).text, /Номер подтверждён/);
        assert.deepEqual((await p().query(`SELECT user_id::text FROM tanbot_${channel}_accounts
          WHERE ${channel}_user_id=$1`, [String(a.id)])).rows, [{ user_id: a.user }]);
      });
    }
    it(`${channel}: a new own contact self-registers, creates a transfer and cannot access another person's track`, async () => {
      const id = ++seq, a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id, party: "" };
      const phone = `+7987${String(id).padStart(7, "0")}`;
      const snapshot = async () => (await p().query(`SELECT jsonb_build_object(
        'persons',(SELECT COUNT(*) FROM tt_external_persons),
        'verifications',(SELECT COUNT(*) FROM tt_external_person_verifications),
        'parties',(SELECT COUNT(*) FROM tt_parties),
        'drafts',(SELECT COUNT(*) FROM tt_external_request_drafts),
        'sessions',(SELECT COUNT(*) FROM tt_external_person_sessions),
        'transfers',(SELECT COUNT(*) FROM tt_transfers),
        'codes',(SELECT COUNT(*) FROM tt_handoff_codes)) AS value`)).rows[0].value;
      const before = await snapshot();
      await send(a, "Создать передачу");
      for (const contact of [{ phone, ownerId: a.id + 1 }, { phone, forwarded: true },
        ...(channel === "max" ? [{ phone, badSignature: true }] : [])]) {
        const rejected = await send(a, "", undefined, undefined, true, contact);
        assert.doesNotMatch(rejected.text, /Номер подтверждён/);
        assert.deepEqual(await snapshot(), before);
      }
      await send(a, "", undefined, undefined, false, { phone });
      assert.deepEqual(await snapshot(), before);
      const contactId = ++seq;
      const reply = await send(a, "", undefined, contactId, true, { phone });
      assert.match(reply.text, /Номер подтверждён/);
      assert.ok(reply.buttons.some(b => b.text === "Создать передачу"));
      const registered = { ...before, persons: before.persons + 1, parties: before.parties + 1,
        verifications: before.verifications + 1, sessions: before.sessions + 1 };
      assert.deepEqual(await snapshot(), registered);
      await send(a, "", undefined, contactId, true, { phone });
      assert.deepEqual(await snapshot(), registered, "webhook replay cannot create another profile/session");
      const identity = (await p().query(`SELECT p.party_id,pt.kind,pt.created_by_user_id FROM tt_external_persons p
        JOIN tt_parties pt ON pt.id=p.party_id WHERE p.phone_e164=$1`, [phone])).rows[0];
      assert.equal(identity.kind, "external");
      assert.equal(identity.created_by_user_id, null);
      const staffAccounts = channel === "max" ? "tanbot_max_accounts" : "tanbot_telegram_accounts";
      const messengerColumn = channel === "max" ? "max_user_id" : "telegram_user_id";
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM ${staffAccounts}
        WHERE ${messengerColumn}=$1`, [String(a.id)])).rows[0].n, 0);
      a.party = identity.party_id;
      const press = async (r: Reply, pattern: RegExp) => {
        const b = r.buttons.find(b => pattern.test(b.text));
        assert.ok(b, JSON.stringify(r));
        const cb = b.payload ?? b.callback_data;
        return send(a, cb ? "" : b.text, cb);
      };
      await press(reply, /^Создать передачу$/);
      let r = await send(a, `Synthetic self-registration item ${a.id}`);
      r = await press(r, /Без вложений|Пропустить/iu);
      r = await press(r, /Пропустить/iu);
      r = await send(a, `+7986${String(a.id).padStart(7, "0")}`);
      r = await send(a, "Synthetic recipient");
      for (let i = 0; i < 3 && !r.buttons.some(b => /Без срока/iu.test(b.text)); i++) {
        r = await press(r, /оставить имя|^далее$/iu);
      }
      r = await press(r, /Без срока/iu);
      await press(r, /^Создать передачу$/);
      const created = (await p().query(`SELECT id,holder_party_id,status FROM tt_transfers
        WHERE creator_party_id=$1`, [a.party])).rows;
      assert.equal(created.length, 1);
      assert.equal(created[0].holder_party_id, a.party);
      assert.equal(created[0].status, "waiting");
      const outsider = await actor(channel), secret = await seed(outsider);
      const mine = await send(a, "Мои передачи");
      assert.doesNotMatch(JSON.stringify(mine), new RegExp(secret.id));
      const secretCode = (await p().query(`SELECT public_code FROM tt_transfers WHERE id=$1`, [secret.id])).rows[0].public_code;
      assert.ok(!JSON.stringify(mine).includes(secretCode));
      const forbidden = await send(a, "", statusView(secret.id));
      assert.doesNotMatch(forbidden.text, /Synthetic receipt item/);
      assert.equal((await state(secret.id)).holder_party_id, outsider.party);
    });
    it(`${channel}: a known own contact registers and can enter creation, but a foreign contact cannot`, async () => {
      const id = ++seq, a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id, party: "" };
      const phone = `+7987${String(id).padStart(7, "0")}`;
      const party = (await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
        VALUES('external','Synthetic allowed contact',$1) RETURNING id`, [phone])).rows[0].id;
      await send(a, "Создать передачу");
      const foreign = await send(a, "", undefined, undefined, true, { phone, ownerId: a.id + 1 });
      assert.doesNotMatch(foreign.text, /Номер подтверждён/);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_person_verifications
        WHERE channel=$1 AND messenger_user_id=$2`, [channel, String(a.id)])).rows[0].n, 0);
      const reply = await send(a, "", undefined, undefined, true, { phone });
      assert.match(reply.text, /Номер подтверждён/);
      const identity = (await p().query(`SELECT p.party_id,p.phone_e164 FROM tt_external_person_verifications v
        JOIN tt_external_persons p ON p.id=v.person_id WHERE v.channel=$1 AND v.messenger_user_id=$2`,
        [channel, String(a.id)])).rows;
      assert.deepEqual(identity, [{ party_id: party, phone_e164: phone }]);
      const create = await send(a, "/new");
      assert.doesNotMatch(create.text, /Номер ещё не подтверждён|Номер не найден/);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_request_drafts
        WHERE person_id=(SELECT person_id FROM tt_external_person_verifications
          WHERE channel=$1 AND messenger_user_id=$2)`, [channel, String(a.id)])).rows[0].n, 1);
    });
    for (const conflict of ["duplicate"] as const) {
      it(`${channel}: ${conflict} phone rejection is explained without verifying the person`, async () => {
        const id = ++seq, a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id, party: "" };
        const phone = `+7987${String(id).padStart(7, "0")}`;
        await p().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
          VALUES('external','Synthetic duplicate A',$1),('external','Synthetic duplicate B',$1)`, [phone]);
        const reply = await send(a, "", undefined, undefined, true, { phone });
        assert.match(reply.text, /несколько контактов/);
        assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_person_verifications
          WHERE channel=$1 AND messenger_user_id=$2`, [channel, String(a.id)])).rows[0].n, 0);
        assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_persons
          WHERE phone_e164=$1`, [phone])).rows[0].n, 0);
      });
    }
    it(`${channel}: employee confirms an own contact without LK navigation and creates as the same staff`, async () => {
      const id = ++seq;
      const phone = `+7987${String(id).padStart(7, "0")}`;
      const user = await createTestUser({ databaseUrl: db, email: `staff-multichannel-${id}@test.local`,
        password: "SyntheticPass123!", fullName: "Synthetic multichannel manager", role: "manager", phone });
      const party = await ensurePartyForUserOnWrite(p(), user.id, "Synthetic multichannel manager", phone);
      const a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id,
        party: party.id, user: user.id };
      const existing = await seed(a);
      const before = await state(existing.id);
      const denied = await send(a, "Создать передачу");
      assert.ok(denied.buttons.some(b => b.text === "Отправить мой номер"));
      const confirmed = await send(a, "", undefined, undefined, true, { phone });
      assert.match(confirmed.text, /Номер подтверждён/);
      assert.doesNotMatch(confirmed.text, /Подключить|сотрудник|\/profile/);
      assert.ok(!confirmed.buttons.some(b => b.text === "Отправить мой номер" || b.url));
      assert.deepEqual(await state(existing.id), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_persons
        WHERE phone_e164=$1`, [phone])).rows[0].n, 0);
      const binding = (await p().query(`SELECT user_id::text FROM tanbot_${channel}_accounts
        WHERE ${channel}_user_id=$1 AND stopped_at IS NULL`, [String(a.id)])).rows;
      assert.deepEqual(binding, [{ user_id: user.id }]);
      const mine = await send(a, "Мои передачи");
      assert.ok(JSON.stringify(mine).includes(existing.id), "pre-existing LK transfer is available in the bot");
      const create = await send(a, "Создать передачу");
      assert.match(create.text, /что.*переда|предмет|шаг 1/iu);
      assert.ok(!create.buttons.some(b => b.url || b.text === "Отправить мой номер"));
      const draft = (await p().query(`SELECT payload FROM tt_external_request_drafts
        WHERE channel=$1 AND messenger_chat_id=$2 AND confirmed_transfer_id IS NULL`,
        [channel, nativeBotDraftChatKey({ channel, messengerChatId: String(a.chat), actor: "staff" })])).rows;
      assert.equal(draft.length, 1);
      assert.equal(draft[0].payload.actor, "staff");
      assert.equal(draft[0].payload.staffUserId, user.id);
      assert.deepEqual(await state(existing.id), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_transfers
        WHERE creator_party_id=$1`, [a.party])).rows[0].n, 1,
      "linking and entering creation do not duplicate the existing transfer");
      const press = async (reply: Reply, pattern: RegExp) => {
        const next = reply.buttons.find(b => pattern.test(b.text));
        assert.ok(next, `Missing ${pattern}: ${JSON.stringify(reply)}`);
        return send(a, "", next.payload ?? next.callback_data!);
      };
      const item = `Synthetic multichannel item ${a.id}`;
      let reply = await send(a, item);
      reply = await press(reply, /^Без вложений$/u);
      reply = await press(reply, /^Пропустить$/u);
      reply = await send(a, `+7986${String(a.id).padStart(7, "0")}`);
      reply = await send(a, "Synthetic multichannel recipient");
      reply = await press(reply, /^Далее$/u);
      reply = await press(reply, /^Без срока$/u);
      await press(reply, /^Создать передачу$/u);
      const created = (await p().query(`SELECT creator_party_id::text,holder_party_id::text,status
        FROM tt_transfers WHERE item_title=$1`, [item])).rows;
      assert.deepEqual(created, [{ creator_party_id: a.party, holder_party_id: a.party, status: "waiting" }]);
      assert.deepEqual(await state(existing.id), before);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_transfers
        WHERE creator_party_id=$1`, [a.party])).rows[0].n, 2);
      assert.equal((await p().query(`SELECT COUNT(*)::int n FROM tt_external_persons
        WHERE phone_e164=$1`, [phone])).rows[0].n, 0, "staff is never registered as an external person");
      const outsider = await actor(channel), secret = await seed(outsider);
      const mineAfterCreate = await send(a, "Мои передачи");
      assert.ok(!JSON.stringify(mineAfterCreate).includes(secret.id));
      const secretBefore = await state(secret.id);
      const forbidden = await send(a, "", statusView(secret.id));
      assert.doesNotMatch(forbidden.text, /Synthetic receipt item/);
      assert.deepEqual(await state(secret.id), secretBefore,
        "own-contact linking must not broaden the manager's access to unrelated transfers");
    });
    it(`${channel}: an unverified person's typed phone returns own-contact guidance without identity, session or draft writes`, async () => {
      const id = ++seq, a: Actor = { channel, id, chat: channel === "max" ? id + 100000 : id, party: "" };
      const snapshot = async () => (await p().query(`SELECT jsonb_build_object(
        'persons',(SELECT COUNT(*) FROM tt_external_persons),
        'verifications',(SELECT COUNT(*) FROM tt_external_person_verifications),
        'drafts',(SELECT COUNT(*) FROM tt_external_request_drafts),
        'sessions',(SELECT COUNT(*) FROM tt_external_person_sessions),
        'transfers',(SELECT COUNT(*) FROM tt_transfers)) AS value`)).rows[0].value;
      const before = await snapshot();
      const create = await send(a, "Создать передачу");
      assert.match(create.text, /Номер, введённый текстом, не подтверждает/);
      for (const phone of ["89990001234", "9990001234", "+7 (999) 000-12-34"]) {
        const reply = await send(a, phone);
        assert.match(reply.text, /Номер ещё не подтверждён/);
        assert.match(reply.text, /Нажмите «Отправить мой номер»/);
        assert.ok(reply.buttons.some(b => b.text === "Отправить мой номер"));
        assert.doesNotMatch(reply.text, /Дополнительные действия|Что передаёте|Что передаете/);
        assert.deepEqual(await snapshot(), before);
      }
      await send(a, "89990001234", undefined, undefined, false);
      assert.deepEqual(await snapshot(), before, "group input must not create trusted identity or draft");
    });
    for (const staff of [true, false]) {
      it(`${channel}: ${staff ? "staff" : "external"} pending cancellation is confirmed, terminal, distinct from completion and never a receipt`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        await p().query(`INSERT INTO tt_transfer_invitations
          (transfer_id,handoff_version,holder_party_id,pending_party_id,item_snapshot) VALUES($1,1,$2,$3,'Synthetic')`,
          [t.id, a.party, t.recipient]);
        await p().query(`INSERT INTO tt_automatic_receipt_codes
          (id,transfer_id,handoff_version,pending_party_id,channel,messenger_user_id,messenger_chat_id)
          VALUES($1,$2,1,$3,$4,$5,$6)`, [randomUUID(), t.id, t.recipient, channel, String(a.id), String(a.chat)]);
        const detail = await send(a, "", t.pick);
        assert.ok(detail.buttons.some(b => b.text === "Изменить получателя"));
        const before = await pendingBusinessSnapshot(t.id);
        await send(a, "", t.callback);
        assert.equal((await entries(a)).length, 1);
        const prompt = await send(a, "", button(detail, "Закрыть как неактуальный"));
        assert.equal((await entries(a)).length, 0, "confirmation navigation leaves OTP input without invalidating code");
        assert.match(prompt.text, /Держатель не изменится/);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before, "opening confirmation changes no business data");
        const cancelled = button(prompt, "Да, закрыть как неактуальный");
        await send(a, "", button(prompt, "Отмена"));
        await send(a, "", cancelled);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before, "cancelled confirmation is inert");
        const fresh = await send(a, "", button(detail, "Закрыть как неактуальный"));
        const confirm = button(fresh, "Да, закрыть как неактуальный");
        const result = await send(a, "", confirm);
        assert.match(result.text, /Неактуален/);
        const after = await state(t.id);
        assert.equal(after.status, "obsolete");
        assert.equal(after.holder_party_id, a.party);
        assert.equal(after.pending_party_id, null);
        assert.equal(after.handoff_version, 2);
        assert.equal(after.successes, 0);
        const terminal = (await p().query(`SELECT first_custody_at,completed_at FROM tt_transfers WHERE id=$1`, [t.id])).rows[0];
        assert.equal(terminal.first_custody_at, null);
        assert.equal(terminal.completed_at, null, "not counted as successful completion");
        assert.equal((await p().query("SELECT count(*)::int n FROM tt_handoff_codes WHERE transfer_id=$1 AND consumed_at IS NULL", [t.id])).rows[0].n, 0);
        assert.equal((await p().query("SELECT count(*)::int n FROM tt_transfer_invitations WHERE transfer_id=$1 AND superseded_at IS NULL", [t.id])).rows[0].n, 0);
        const automatic = (await p().query("SELECT status,encrypted_code FROM tt_automatic_receipt_codes WHERE transfer_id=$1", [t.id])).rows[0];
        assert.equal(automatic.status, "cancelled");
        assert.equal(automatic.encrypted_code, null);
        const active = await seed(a);
        const snapshot = await pendingBusinessSnapshot(t.id);
        await assert.rejects(withTransaction(client => assignPendingRecipientInTransaction(client, {
          transferId: t.id, holderPartyId: a.party, pendingPartyId: active.recipient,
          auditUserId: a.user ?? null, expectedHandoffVersion: 2, expectedRowVersion: 2,
        })), "generic route assignment cannot reopen obsolete");
        await assert.rejects(withTransaction(client => completeTransferMutation(client, {
          transferId: t.id, actingPartyId: a.party, auditUserId: a.user ?? null, allowLegacyComplete: true,
        })), "obsolete must not be converted into successful completion");
        await send(a, "", confirm);
        await send(a, "", t.callback);
        await send(a, code);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), snapshot, "duplicate and stale callbacks cannot mutate terminal track");
        const list = await send(a, "Мои передачи");
        const visible = list.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(visible[0]!.text, `${active.id} · Ожидает получения`);
        assert.ok(!visible.some(b => b.text.includes(t.id)));
        const archive = await send(a, "", button(list, "Архив"));
        const view = await send(a, "", button(archive, `${t.id} · Неактуален`));
        assert.match(view.text, /Статус: Неактуален/);
        assert.doesNotMatch(view.text, /Статус: Завершён|Получение подтверждено/);
        assert.ok(!view.buttons.some(b => /Ввести код|Закрыть|Завершить|Изменить получателя|Передать дальше/.test(b.text)));
      });
      it(`${channel}: ${staff ? "staff" : "external"} replacing pending recipient keeps one track and holder, invalidates old artifacts and updates unreceived final addressee`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const before = await pendingBusinessSnapshot(t.id);
        const detail = await send(a, "", t.pick);
        await send(a, "", t.callback);
        assert.equal((await entries(a)).length, 1);
        const choice = await send(a, "", button(detail, "Изменить получателя"));
        assert.equal((await entries(a)).length, 0, "recipient draft cannot consume OTP attempts");
        const { summary } = await selectForwardRecipient(a, choice, true);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before, "recipient draft cannot change transfer or invalidate old code");
        const confirm = button(summary, "Подтвердить замену");
        await send(a, "", confirm);
        const next = await state(t.id);
        assert.equal(next.holder_party_id, a.party);
        assert.notEqual(next.pending_party_id, t.recipient);
        assert.equal(next.handoff_version, 2);
        assert.equal(next.successes, 0);
        assert.equal((await p().query("SELECT count(*)::int n FROM tt_transfers WHERE id=$1", [t.id])).rows[0].n, 1);
        assert.equal((await p().query("SELECT final_recipient_party_id FROM tt_transfers WHERE id=$1", [t.id])).rows[0].final_recipient_party_id, next.pending_party_id);
        assert.equal((await p().query("SELECT count(*)::int n FROM tt_handoff_codes WHERE transfer_id=$1 AND handoff_version=1 AND consumed_at IS NULL", [t.id])).rows[0].n, 0);
        assert.ok((await p().query("SELECT 1 FROM tt_transfer_revoked_parties WHERE transfer_id=$1 AND party_id=$2", [t.id, t.recipient])).rowCount);
        const snapshot = await pendingBusinessSnapshot(t.id);
        await send(a, "", confirm);
        await send(a, "", t.callback);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), snapshot, "duplicate and old handoff callbacks are inert");
      });
      it(`${channel}: ${staff ? "staff" : "external"} OTP winning before pending cancellation confirmation prevents cancellation`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const detail = await send(a, "", t.pick);
        const prompt = await send(a, "", button(detail, "Закрыть как неактуальный"));
        await withTransaction(async client => {
          const row = (await client.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [t.id])).rows[0];
          assert.equal((await verifyPendingReceiptCode(client, { row, code, auditUserId: a.user ?? null, actingPartyId: a.party })).ok, true);
        });
        const snapshot = await pendingBusinessSnapshot(t.id);
        const reply = await send(a, "", button(prompt, "Да, закрыть как неактуальный"));
        assert.match(reply.text, /изменилась|недоступна|устарела/);
        assert.equal((await state(t.id)).holder_party_id, t.recipient);
        assert.notEqual((await state(t.id)).status, "obsolete");
        assert.deepEqual(await pendingBusinessSnapshot(t.id), snapshot);
      });
      it(`${channel}: ${staff ? "staff" : "external"} pending controls reject foreign, group and stale bindings`, async () => {
        const a = await actor(channel, staff), other = await actor(channel, staff), t = await seed(a);
        const before = await statusBusinessSnapshot(t.id);
        for (const action of ["change", "void"] as const) {
          const callback = buildReceiptEntryCallback(action, t.id, 1)!;
          for (const [who, privateDialog] of [[other, true], [a, false]] as const) {
            const reply = await send(who, "", callback, undefined, privateDialog);
            assert.ok(!reply.buttons.some(b => /Подтвердить замену|Да, закрыть/.test(b.text)));
          }
        }
        assert.deepEqual(await statusBusinessSnapshot(t.id), before);
        if (staff) await p().query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        else await p().query("DELETE FROM tt_external_person_verifications WHERE channel=$1 AND messenger_user_id=$2", [channel, String(a.id)]);
        await send(a, "", buildReceiptEntryCallback("void", t.id, 1)!);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before);
      });
      it(`${channel}: ${staff ? "staff" : "external"} OTP winning before replacement confirmation prevents redirecting received track`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const prompt = await send(a, "", buildReceiptEntryCallback("change", t.id, 1)!);
        const { summary } = await selectForwardRecipient(a, prompt, true);
        await withTransaction(async client => {
          const row = (await client.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [t.id])).rows[0];
          assert.equal((await verifyPendingReceiptCode(client, { row, code, auditUserId: a.user ?? null, actingPartyId: a.party })).ok, true);
        });
        const before = await pendingBusinessSnapshot(t.id);
        const reply = await send(a, "", button(summary, "Подтвердить замену"));
        assert.match(reply.text, /изменилась|недоступна|устарела/);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before);
        assert.equal((await state(t.id)).holder_party_id, t.recipient);
      });
      it(`${channel}: ${staff ? "staff" : "external"} concurrent canonical obsolete close and OTP serialize to exactly one outcome`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const outcomes = await Promise.all([
          withTransaction(async client => {
            await markPendingObsoleteInTransaction(client, { transferId: t.id, actorPartyId: a.party,
              auditUserId: a.user ?? null, expectedRowVersion: 1, expectedHandoffVersion: 1 });
            return { kind: "obsolete", ok: true };
          }).catch(() => ({ kind: "obsolete", ok: false })),
          withTransaction(async client => {
            const row = (await client.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [t.id])).rows[0];
            return { kind: "otp", ok: (await verifyPendingReceiptCode(client, {
              row, code, auditUserId: a.user ?? null, actingPartyId: a.party,
            })).ok };
          }),
        ]);
        assert.equal(outcomes.filter(x => x.ok).length, 1);
        const row = await state(t.id);
        if (outcomes.find(x => x.kind === "obsolete")!.ok) {
          assert.equal(row.status, "obsolete");
          assert.equal(row.holder_party_id, a.party);
          assert.equal(row.successes, 0);
        } else {
          assert.equal(row.holder_party_id, t.recipient);
          assert.notEqual(row.status, "obsolete");
          assert.equal(row.successes, 1);
        }
        assert.equal(row.pending_party_id, null);
        assert.equal(row.handoff_version, 2);
      });
      it(`${channel}: ${staff ? "staff" : "external"} replacing pending onward recipient preserves confirmed custody and original final recipient`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        await p().query("UPDATE tt_transfers SET first_custody_at=NOW(),creator_party_id=$2 WHERE id=$1", [t.id, t.recipient]);
        const detail = await send(a, "", t.pick);
        const prompt = await send(a, "", button(detail, "Изменить получателя"));
        const { summary } = await selectForwardRecipient(a, prompt, true);
        await send(a, "", button(summary, "Подтвердить замену"));
        const row = (await p().query("SELECT * FROM tt_transfers WHERE id=$1", [t.id])).rows[0];
        assert.equal(row.final_recipient_party_id, t.recipient);
        assert.equal(row.holder_party_id, a.party);
        assert.notEqual(row.pending_party_id, t.recipient);
        assert.ok(row.first_custody_at);
      });
      it(`${channel}: ${staff ? "staff" : "external"} empty active and archive lists retain navigation and load fresh membership`, async () => {
        const a = await actor(channel, staff);
        const active = await send(a, "Мои передачи");
        assert.match(active.text, /Пока нет активных передач/);
        const openArchive = button(active, "Архив");
        const empty = await send(a, "", openArchive);
        assert.match(empty.text, /В архиве пока нет/);
        assert.equal(empty.buttons.filter(b => /^TT-/u.test(b.text)).length, 0);
        const back = await send(a, "", button(empty, "К активным передачам"));
        assert.ok(back.buttons.some(b => b.text === "Архив"));
        const closed = await seedClosed(a, "obsolete"), working = await seedReceived(a);
        const archive = await send(a, "", openArchive);
        assert.deepEqual(archive.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text), [`${closed.id} · Неактуален`]);
        const fresh = await send(a, "", button(archive, "К активным передачам"));
        assert.deepEqual(fresh.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text), [`${working.id} · В работе`]);
      });
      it(`${channel}: ${staff ? "staff" : "external"} archive paginates closed states separately and cards return to their archive page`, async () => {
        const a = await actor(channel, staff), ids: string[] = [];
        for (let i = 0; i < 7; i++) {
          const t = await seedClosed(a, i % 2 ? "obsolete" : "completed");
          await p().query("UPDATE tt_transfers SET created_at=NOW()+$2::int*INTERVAL '1 minute' WHERE id=$1", [t.id, i]);
          ids.push(t.id);
        }
        const working = await seedReceived(a);
        const before = await statusBusinessSnapshot(ids[0]!);
        const active = await send(a, "Мои передачи");
        assert.deepEqual(active.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text), [`${working.id} · В работе`]);
        const first = await send(a, "", button(active, "Архив"));
        const firstChoices = first.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(firstChoices.length, 5);
        assert.ok(!first.buttons.some(b => b.text === "Предыдущие передачи"));
        const second = await send(a, "", button(first, "Следующие передачи"));
        const secondChoices = second.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(secondChoices.length, 2);
        assert.ok(!second.buttons.some(b => b.text === "Следующие передачи"));
        const shown = [...firstChoices, ...secondChoices].map(b =>
          parseTrackStatusCallback(b.payload ?? b.callback_data!)!);
        assert.deepEqual(shown.map(b => b.action === "view" ? b.transferId : "").sort(), ids.sort());
        assert.ok(shown.every(b => b.action === "view" && b.archivePage !== undefined));
        const card = await send(a, "", button(second, secondChoices[0]!.text));
        assert.deepEqual(card.buttons.map(b => b.text), ["Обновить статус", "К архиву", "Главное меню"]);
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        const returned = await send(a, "", button(refreshed, "К архиву"));
        assert.deepEqual(returned.buttons.filter(b => /^TT-/u.test(b.text)), secondChoices);
        const previous = await send(a, "", button(returned, "Предыдущие передачи"));
        assert.deepEqual(previous.buttons.filter(b => /^TT-/u.test(b.text)), firstChoices);
        const distant = await send(a, "", buildReceiptEntryCallback("archive", "99999", 1)!);
        assert.match(distant.text, /В архиве пока нет/);
        assert.ok(distant.buttons.some(b => b.text === "Предыдущие передачи"));
        assert.ok(distant.buttons.some(b => b.text === "К активным передачам"));
        assert.deepEqual(await statusBusinessSnapshot(ids[0]!), before, "archive navigation never sets general_archived_at or changes business data");
      });
      it(`${channel}: ${staff ? "staff" : "external"} archive navigation leaves OTP mode safely and preserves an existing creation draft`, async () => {
        const a = await actor(channel, staff), waiting = await seed(a), closed = await seedClosed(a);
        const openArchive = buildReceiptEntryCallback("archive", "0", 1)!;
        await send(a, "", waiting.callback);
        assert.equal((await entries(a)).length, 1);
        const before = await statusBusinessSnapshot(waiting.id);
        const archive = await send(a, "", openArchive);
        assert.equal((await entries(a)).length, 0);
        await send(a, code);
        assert.deepEqual(await statusBusinessSnapshot(waiting.id), before, "archive must not verify, consume or invalidate the handoff code");
        await send(a, "Создать передачу");
        const draftBefore = await statusBusinessSnapshot(closed.id);
        const again = await send(a, "", openArchive);
        const card = await send(a, "", button(again, `${closed.id} · Завершён`));
        await send(a, "", button(card, "К архиву"));
        assert.deepEqual(await statusBusinessSnapshot(closed.id), draftBefore, "archive must not cancel or modify the creation draft");
        assert.ok(archive.buttons.some(b => b.text === "К активным передачам"));
      });
      it(`${channel}: ${staff ? "staff" : "external"} archive rechecks holder, terminal state, deletion, group chat and live binding`, async () => {
        const a = await actor(channel, staff), other = await actor(channel, staff);
        const openArchive = buildReceiptEntryCallback("archive", "0", 1)!;
        for (const update of ["holder_party_id=creator_party_id", "status='active'",
          "general_archived_at=NOW()", "deleted_at=NOW()"]) {
          const t = await seedClosed(a);
          const archive = await send(a, "", openArchive);
          const oldView = button(archive, `${t.id} · Завершён`);
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [t.id]);
          const before = await statusBusinessSnapshot(t.id);
          const denied = await send(a, "", oldView);
          assert.match(denied.text, /не найден или недоступен/, update);
          assert.ok(denied.buttons.some(b => b.text === "К архиву"));
          assert.ok(!denied.buttons.some(b => /Передать дальше|Завершить трек/.test(b.text)));
          assert.deepEqual(await statusBusinessSnapshot(t.id), before);
        }
        const t = await seedClosed(a);
        const forged = buildTrackStatusCallback({ action: "view", transferId: t.id, archivePage: 0 })!;
        assert.match((await send(other, "", forged)).text, /не найден или недоступен/);
        const group = await send(a, "", openArchive, undefined, false);
        assert.ok(!group.buttons.some(b => /^TT-/u.test(b.text)));
        const groupCard = await send(a, "", forged, undefined, false);
        assert.doesNotMatch(groupCard.text, /Последний держатель|Synthetic sender/);
        if (staff) await p().query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        else await p().query(`DELETE FROM tt_external_person_verifications WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        const revoked = await send(a, "", openArchive);
        assert.ok(!revoked.buttons.some(b => /^TT-/u.test(b.text)));
        assert.doesNotMatch((await send(a, "", forged)).text, /Последний держатель|Synthetic sender/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} all track entry points share holder actions without changing business data`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        const before = await statusBusinessSnapshot(t.id);
        const list = await send(a, "Мои передачи");
        const detail = await send(a, "", button(list, `${t.id} · В работе`));
        const actionButtons = (reply: Reply) => reply.buttons.filter(b =>
          b.text === "Передать дальше" || b.text === "Завершить трек");
        assert.deepEqual(actionButtons(detail).map(b => b.text), ["Передать дальше", "Завершить трек"]);
        const statuses = await send(a, "Статус трека");
        const card = await send(a, "", button(statuses, `${t.id} · Synthetic sender`));
        const search = await send(a, `Статус ${t.id}`);
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        for (const reply of [card, search, refreshed]) {
          assert.deepEqual(actionButtons(reply), actionButtons(detail));
          assert.match(reply.text, /Получение подтверждено. Трек открыт/);
          assert.ok(reply.buttons.some(b => b.text === "Обновить статус"));
          assert.ok(reply.buttons.some(b => b.text === "К списку треков"));
        }
        assert.deepEqual(await statusBusinessSnapshot(t.id), before, "opening any card only reads business data");
        const intermediate = await seedReceived(a, false);
        const intermediateCard = await send(a, "", statusView(intermediate.id));
        assert.deepEqual(actionButtons(intermediateCard).map(b => b.text), ["Передать дальше"]);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status starts the canonical forward flow and keeps the same track`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        const before = await statusBusinessSnapshot(t.id);
        const card = await send(a, "", statusView(t.id));
        const start = await send(a, "", button(card, "Передать дальше"));
        const { summary } = await selectForwardRecipient(a, start);
        const unchanged = await statusBusinessSnapshot(t.id);
        assert.deepEqual(unchanged.transfer, before.transfer, "recipient draft is not a transfer");
        await send(a, "", button(summary, "Передать дальше"));
        const next = await state(t.id);
        assert.equal(next.holder_party_id, a.party);
        assert.ok(next.pending_party_id);
        assert.equal(next.status, "waiting");
        assert.equal(next.handoff_version, 2);
        assert.equal(next.successes, 0, "forwarding does not manufacture receipt");
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        assert.match(refreshed.text, /Ожидает подтверждения получения/);
        assert.ok(!refreshed.buttons.some(b => /Передать дальше|Завершить трек/.test(b.text)));
      });
      it(`${channel}: ${staff ? "staff" : "external"} status completion needs separate confirmation and respects cancellation`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        const before = await pendingBusinessSnapshot(t.id);
        const card = await send(a, "", statusView(t.id));
        const prompt = await send(a, "", button(card, "Завершить трек"));
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before);
        const cancelled = button(prompt, "Да, завершить трек");
        await send(a, "", button(prompt, "Отмена"));
        await send(a, "", cancelled);
        assert.deepEqual(await pendingBusinessSnapshot(t.id), before);
        const fresh = await send(a, "", button(card, "Завершить трек"));
        await send(a, "", button(fresh, "Да, завершить трек"));
        assert.equal((await state(t.id)).status, "completed");
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        assert.match(refreshed.text, /Статус: Завершён/);
        assert.ok(!refreshed.buttons.some(b => /Передать дальше|Завершить трек/.test(b.text)));
      });
      it(`${channel}: ${staff ? "staff" : "external"} status never gives holder actions to observers or unavailable tracks`, async () => {
        const a = await actor(channel, staff);
        for (const update of [
          "pending_party_id=final_recipient_party_id,status='waiting'",
          "status='completed'", "status='obsolete'", "general_archived_at=NOW()", "deleted_at=NOW()",
          "holder_party_id=creator_party_id",
        ]) {
          const t = await seedReceived(a);
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [t.id]);
          const before = await statusBusinessSnapshot(t.id);
          const card = await send(a, "", statusView(t.id));
          assert.ok(!card.buttons.some(b => /Передать дальше|Завершить трек/.test(b.text)), update);
          assert.deepEqual(await statusBusinessSnapshot(t.id), before);
        }
      });
      it(`${channel}: ${staff ? "staff" : "external"} status action callbacks recheck versions, ownership, closure and live binding`, async () => {
        const a = await actor(channel, staff);
        for (const update of [
          "handoff_version=handoff_version+1", "holder_party_id=creator_party_id",
          "pending_party_id=creator_party_id,status='waiting'",
          "status='completed'", "status='obsolete'", "general_archived_at=NOW()", "deleted_at=NOW()",
        ]) {
          const t = await seedReceived(a);
          const card = await send(a, "", statusView(t.id));
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [t.id]);
          const before = await statusBusinessSnapshot(t.id);
          for (const action of ["Передать дальше", "Завершить трек"]) {
            await send(a, "", button(card, action));
            assert.deepEqual(await statusBusinessSnapshot(t.id), before, `${update}: ${action} must be inert`);
          }
        }
        const t = await seedReceived(a);
        const card = await send(a, "", statusView(t.id));
        const before = await statusBusinessSnapshot(t.id);
        for (const action of ["Передать дальше", "Завершить трек"]) {
          await send(a, "", button(card, action), undefined, false);
          assert.deepEqual(await statusBusinessSnapshot(t.id), before, "group callbacks are inert");
        }
        if (staff) await p().query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        else await p().query(`DELETE FROM tt_external_person_verifications WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        for (const action of ["Передать дальше", "Завершить трек"]) {
          await send(a, "", button(card, action));
          assert.deepEqual(await statusBusinessSnapshot(t.id), before, "revoked bindings are inert");
        }
      });
      it(`${channel}: ${staff ? "staff" : "external"} status is fresh, read-only and follows the holder only after OTP`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        const before = await statusBusinessSnapshot(t.id);
        const list = await send(a, "", buildNativeCreateCallback("menu_status", NATIVE_MENU_DRAFT_HEX, 1)!);
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(t.id)));
        const card = await send(a, "", statusView(t.id));
        assert.match(card.text, /Текущий держатель: Synthetic sender/);
        assert.match(card.text, /Следующий получатель: Synthetic recipient/);
        assert.match(card.text, /Ожидает подтверждения получения/);
        assert.doesNotMatch(card.text, /Телефон|\+7999|345678|tt_hat=|est=/);
        const search = await send(a, `Статус ${t.id}`);
        assert.match(search.text, /Текущий держатель: Synthetic sender/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before);
        await pickTransferAndEnterCode(a, t);
        await send(a, code);
        const afterOtp = await statusBusinessSnapshot(t.id);
        const refreshed = await send(a, "", button(card, "Обновить статус"));
        assert.match(refreshed.text, /Текущий держатель: Synthetic recipient/);
        assert.match(refreshed.text, /Получение подтверждено. Трек открыт/);
        assert.doesNotMatch(refreshed.text, /Следующий получатель|Статус: Завершён/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), afterOtp);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status rechecks visibility, deletion, private chat and live profile binding`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=ANY($1::uuid[])", [[a.user, foreign.user]]);
        const t = await seed(a), other = await seed(foreign);
        const absent = await send(a, "", statusView("TT-2026-999999999999"));
        const denied = await send(a, "", statusView(other.id));
        assert.equal(denied.text, absent.text);
        assert.doesNotMatch(denied.text, new RegExp(other.id));
        const group = await send(a, "", statusView(t.id), undefined, false);
        assert.doesNotMatch(group.text, /Текущий держатель|Synthetic sender/);
        await p().query("UPDATE tt_transfers SET creator_party_id=$2,holder_party_id=$2,pending_party_id=NULL,final_recipient_party_id=$2 WHERE id=$1", [t.id, foreign.party]);
        assert.equal((await send(a, "", statusView(t.id))).text, absent.text);
        const deleted = await seed(a);
        await p().query("UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1", [deleted.id]);
        assert.equal((await send(a, `Статус ${deleted.id}`)).text, absent.text);
        const bound = await seed(a);
        if (staff) await p().query(`UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        else await p().query(`DELETE FROM tt_external_person_verifications WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        const revoked = await send(a, "", statusView(bound.id));
        assert.doesNotMatch(revoked.text, /Текущий держатель|Synthetic sender/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status list shows the live holder, not pending recipient, and changes only after canonical OTP receipt`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const before = await statusBusinessSnapshot(t.id);
        const first = await send(a, "Статус трека");
        assert.equal(button(first, `${t.id} · Synthetic sender`), statusView(t.id));
        assert.ok(!first.buttons.some(b => b.text.includes(t.id) && /Synthetic recipient|Synthetic receipt item/.test(b.text)));
        assert.match(first.text, /Номер трека · Текущий держатель/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before, "showing holder names is read-only");
        // A staff party may contain an old copied name; the canonical resolver uses today's users.full_name.
        if (staff) await p().query("UPDATE users SET full_name='Current staff holder' WHERE id=$1", [a.user]);
        else await p().query("UPDATE tt_parties SET display_name='Current external holder' WHERE id=$1", [a.party]);
        const renamed = await send(a, "Статус трека");
        assert.equal(button(renamed, `${t.id} · Current ${staff ? "staff" : "external"} holder`), statusView(t.id));
        await pickTransferAndEnterCode(a, t);
        await send(a, code);
        const received = await state(t.id);
        assert.equal(received.holder_party_id, t.recipient);
        const afterReceipt = await statusBusinessSnapshot(t.id);
        const forwarded = await send(a, "Статус трека");
        assert.equal(button(forwarded, `${t.id} · Synthetic recipient`), statusView(t.id));
        const card = await send(a, "", statusView(t.id));
        assert.match(card.text, /Текущий держатель: Synthetic recipient/);
        assert.deepEqual(await statusBusinessSnapshot(t.id), afterReceipt, "list and card must not mutate the received track");
      });
      it(`${channel}: ${staff ? "staff" : "external"} status holder labels keep pagination and distinguish closed states without changing My Transfers`, async () => {
        const a = await actor(channel, staff), expected = new Map<string, string>();
        for (let i = 0; i < 7; i++) {
          const closed = i % 3 === 1 ? "completed" : i % 3 === 2 ? "obsolete" : null;
          const t = closed ? await seedClosed(a, closed) : await seed(a);
          expected.set(statusView(t.id), `${t.id} · Synthetic sender${closed === "completed" ? " · Завершён" : closed === "obsolete" ? " · Неактуален" : ""}`);
        }
        const first = await send(a, "Статус трека");
        assert.match(first.text, /У завершённых и неактуальных указан последний держатель/);
        const second = await send(a, "", button(first, "Следующие"));
        assert.match(second.text, /Страница 2 из/);
        const shown = [...first.buttons, ...second.buttons].filter(b => expected.has(b.payload ?? b.callback_data!));
        assert.equal(shown.length, 7);
        assert.equal(new Set(shown.map(b => b.payload ?? b.callback_data)).size, 7);
        for (const b of shown) assert.equal(b.text, expected.get(b.payload ?? b.callback_data!));
        const previous = await send(a, "", button(second, "Предыдущие"));
        assert.deepEqual(previous.buttons, first.buttons);
        const own = await send(a, "Мои передачи");
        const ownTracks = own.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(ownTracks.length, 3);
        assert.ok(ownTracks.every(b => b.text.endsWith(" · Ожидает получения")));
        const archive = await send(a, "", button(own, "Архив"));
        const archived = archive.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(archived.length, 4);
        assert.ok(archived.every(b => / · (Завершён|Неактуален)$/.test(b.text) && !b.text.includes("Synthetic sender")));
      });
      it(`${channel}: ${staff ? "staff" : "external"} status respects canonical historical-only visibility`, async () => {
        const a = await actor(channel, staff), owner = await actor(channel, false), t = await seed(owner);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        await p().query(`INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note)
          VALUES($1,$2,$3,'Назначен следующий получатель')`, [t.id, a.party, owner.party]);
        const auditOnly = await send(a, "", statusView(t.id));
        assert.match(auditOnly.text, /не найден или недоступен/);
        await p().query(`UPDATE tt_transfer_timeline SET note='Получение подтверждено' WHERE transfer_id=$1`, [t.id]);
        const historical = await send(a, "", statusView(t.id));
        if (staff) assert.match(historical.text, /Текущий держатель: Synthetic sender/);
        else assert.match(historical.text, /не найден или недоступен/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} status handles completion/archive, pending/final access, paging, drafts and code-input navigation`, async () => {
        const a = await actor(channel, staff), owner = await actor(channel, false);
        if (staff) await p().query("UPDATE users SET role='manager' WHERE id=$1", [a.user]);
        for (const column of ["pending_party_id", "final_recipient_party_id"]) {
          const t = await seed(owner);
          await p().query(`UPDATE tt_transfers SET ${column}=$2 WHERE id=$1`, [t.id, a.party]);
          assert.match((await send(a, "", statusView(t.id))).text, /Текущий держатель: Synthetic sender/);
        }
        const t = await seed(a);
        await p().query("UPDATE tt_transfers SET status='completed',pending_party_id=NULL,completed_at=NOW(),general_archived_at=NOW() WHERE id=$1", [t.id]);
        const completed = await send(a, "", statusView(t.id));
        assert.match(completed.text, /Статус: Завершён/);
        assert.match(completed.text, /Последний держатель: Synthetic sender/);
        assert.match(completed.text, /в общем архиве/);
        const ready = await seed(a);
        await p().query("UPDATE tt_transfers SET pending_party_id=NULL,status='active' WHERE id=$1", [ready.id]);
        assert.match((await send(a, "", statusView(ready.id))).text, /Первое получение пока не подтверждено/);
        for (let i = 0; i < 6; i++) await seed(a);
        const first = await send(a, "Статус трека");
        const next = await send(a, "", button(first, "Следующие"));
        assert.match(next.text, /Страница 2 из/);
        assert.ok(next.buttons.some(b => b.text === "Предыдущие"));
        await send(a, "Создать передачу");
        const before = await statusBusinessSnapshot(t.id);
        await send(a, `Статус ${t.id}`);
        assert.deepEqual(await statusBusinessSnapshot(t.id), before, "read must preserve a creation draft");
        const waiting = await seed(a);
        await send(a, "", waiting.callback);
        const beforeRead = await statusBusinessSnapshot(waiting.id);
        await send(a, `Статус ${waiting.id}`);
        assert.equal((await entries(a)).length, 0);
        assert.deepEqual(await statusBusinessSnapshot(waiting.id), beforeRead, "status navigation must not attempt OTP verification");
      });
      it(`${channel}: ${staff ? "staff" : "external"} my transfers shows active labels and moves closed tracks into a read-only archive`, async () => {
        const a = await actor(channel, staff);
        const waiting = await seed(a), received = await seedReceived(a), active = await seed(a), completed = await seedReceived(a);
        await p().query("UPDATE tt_transfers SET status='active',pending_party_id=NULL WHERE id=$1", [active.id]);
        await p().query("UPDATE tt_transfers SET status='completed',completed_at=NOW(),created_at=NOW()+INTERVAL '1 day' WHERE id=$1", [completed.id]);
        const before = await statusBusinessSnapshot(completed.id);
        const list = await send(a, "Мои передачи");
        const choices = list.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(choices.length, 3);
        assert.ok(!choices.some(b => b.text.includes(completed.id)));
        assert.ok(choices.some(b => b.text === `${waiting.id} · Ожидает получения`));
        assert.ok(choices.some(b => b.text === `${received.id} · В работе`));
        assert.ok(choices.some(b => b.text === `${active.id} · В работе`));
        assert.equal((await state(received.id)).status, "delivered", "received must not mean completed");
        assert.deepEqual(list.buttons.filter(b => !/^TT-/u.test(b.text)).map(b => b.text), ["Архив", "Меню"]);
        const archive = await send(a, "", button(list, "Архив"));
        assert.deepEqual(archive.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text), [`${completed.id} · Завершён`]);
        const detail = await send(a, "", button(archive, `${completed.id} · Завершён`));
        assert.match(detail.text, /Статус: Завершён/);
        assert.ok(!detail.buttons.some(b => /Передать дальше|Завершить|Ввести код|Запросить код/.test(b.text)));
        assert.deepEqual(await statusBusinessSnapshot(completed.id), before, "list and completed card must not mutate domain data");
        const working = await send(a, "", received.pick);
        assert.ok(working.buttons.some(b => b.text === "Передать дальше"));
      });
      it(`${channel}: ${staff ? "staff" : "external"} active pagination never mixes closed tracks from archive`, async () => {
        const a = await actor(channel, staff), activeIds: string[] = [], completedIds: string[] = [];
        for (let i = 0; i < 6; i++) activeIds.push((await seed(a)).id);
        for (let i = 0; i < 2; i++) {
          const t = await seedReceived(a);
          await p().query("UPDATE tt_transfers SET status='completed',completed_at=NOW(),created_at=NOW()+INTERVAL '1 day' WHERE id=$1", [t.id]);
          completedIds.push(t.id);
        }
        const first = await send(a, "Мои передачи");
        const firstChoices = first.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(firstChoices.length, 5);
        assert.ok(firstChoices.every(b => b.text.endsWith(" · Ожидает получения")));
        const second = await send(a, "", button(first, "Следующие передачи"));
        const secondChoices = second.buttons.filter(b => /^TT-/u.test(b.text));
        assert.equal(secondChoices.length, 1);
        assert.ok(secondChoices[0]!.text.endsWith(" · Ожидает получения"));
        assert.deepEqual([...firstChoices, ...secondChoices].map(b => b.text.split(" · ")[0]).sort(),
          activeIds.sort(), "no skipped or repeated active tracks between pages");
        const archive = await send(a, "", button(second, "Архив"));
        assert.deepEqual(archive.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text.split(" · ")[0]).sort(), completedIds.sort());
        const previous = await send(a, "", button(second, "Предыдущие передачи"));
        assert.deepEqual(previous.buttons.filter(b => /^TT-/u.test(b.text)), firstChoices);
      });
      it(`${channel}: ${staff ? "staff" : "external"} completed my transfers excludes foreign, historical-only, deleted and archived rows`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff);
        const own = await seedReceived(a), other = await seedReceived(foreign), history = await seedReceived(a),
          deleted = await seedReceived(a), archived = await seedReceived(a);
        for (const t of [own, other, history, deleted, archived]) {
          await p().query("UPDATE tt_transfers SET status='completed',completed_at=NOW() WHERE id=$1", [t.id]);
        }
        await p().query("UPDATE tt_transfers SET creator_party_id=$2,holder_party_id=$3 WHERE id=$1", [history.id, a.party, foreign.party]);
        await p().query("UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1", [deleted.id]);
        await p().query("UPDATE tt_transfers SET general_archived_at=NOW() WHERE id=$1", [archived.id]);
        const before = await statusBusinessSnapshot(own.id);
        const list = await send(a, "Мои передачи");
        assert.equal(list.buttons.filter(b => /^TT-/u.test(b.text)).length, 0);
        const archive = await send(a, "", button(list, "Архив"));
        assert.deepEqual(archive.buttons.filter(b => /^TT-/u.test(b.text)).map(b => b.text), [`${own.id} · Завершён`]);
        const group = await send(a, "Мои передачи", undefined, undefined, false);
        assert.ok(!group.buttons.some(b => /^TT-/u.test(b.text)));
        for (const action of ["pick", "code", "retry", "forward", "close"] as const) {
          const stale = await send(a, "", buildReceiptEntryCallback(action, own.id, 1)!);
          assert.match(stale.text, /недоступна|устарела/);
        }
        assert.deepEqual(await statusBusinessSnapshot(own.id), before, "stale mutation buttons cannot reopen or change a completed track");
      });
      it(`${channel}: ${staff ? "staff" : "external"} received track is listed, forwarded without duplication, and custody changes only by OTP`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        const count = (await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n;
        const list = await send(a, "Мои передачи");
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
        const detail = await send(a, "", t.pick);
        assert.ok(detail.buttons.some(b => b.text === "Передать дальше"));
        assert.ok(detail.buttons.some(b => b.text === "Завершить трек"));
        assert.ok(!detail.buttons.some(b => b.text === "Ввести код"));
        const start = await send(a, "", button(detail, "Передать дальше"));
        const { summary, phone } = await selectForwardRecipient(a, start);
        assert.equal((await state(t.id)).pending_party_id, null);
        const confirm = button(summary, "Передать дальше");
        const attempts = await Promise.all([send(a, "", confirm), send(a, "", confirm)]);
        const done = attempts.find(r => /назначен следующий получатель/.test(r.messages?.[0]?.text ?? r.text))!;
        assert.ok(done, "one concurrent confirmation succeeds");
        assert.match(done.messages?.[0]?.text ?? done.text, /назначен следующий получатель/);
        const pending = await state(t.id);
        assert.equal(pending.holder_party_id, a.party);
        assert.ok(pending.pending_party_id);
        assert.equal(pending.handoff_version, 2);
        assert.equal(pending.status, "waiting");
        assert.equal((await p().query("SELECT phone_e164 FROM tt_parties WHERE id=$1",
          [pending.pending_party_id])).rows[0].phone_e164, phone);
        assert.equal((await p().query("SELECT final_recipient_party_id FROM tt_transfers WHERE id=$1",
          [t.id])).rows[0].final_recipient_party_id, a.party);
        await send(a, "", confirm);
        assert.equal((await state(t.id)).handoff_version, 2, "confirmation replay is inert");
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n, count);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='holder_pending_change'",
          [t.id])).rows[0].n, 1);
        await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
          VALUES($1,2,$2,$3,NOW()+INTERVAL '10 minutes')`, [t.id, pending.pending_party_id, hashOtp(code, requireHandoffOtpPepper())]);
        await send(a, "", buildReceiptEntryCallback("code", t.id, 2)!);
        await send(a, code);
        assert.equal((await state(t.id)).holder_party_id, pending.pending_party_id);
        assert.notEqual((await state(t.id)).status, "completed");
        assert.match((await send(a, "", buildReceiptEntryCallback("close", t.id, 3)!)).text, /недоступна|устарела/);
      });
      it(`${channel}: ${staff ? "staff" : "external"} completion requires a bound confirmation, cancellation/replay are safe`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seedReceived(a);
        const close = buildReceiptEntryCallback("close", t.id, 1)!;
        assert.match((await send(foreign, "", close)).text, /недоступна|устарела/);
        let prompt = await send(a, "", close);
        assert.match(prompt.text, /Подтвердите, что задача выполнена/);
        assert.equal((await state(t.id)).status, "delivered", "opening prompt must not close");
        const cancelledConfirm = button(prompt, "Да, завершить трек");
        await send(a, "", button(prompt, "Отмена"));
        await send(a, "", cancelledConfirm);
        assert.equal((await state(t.id)).status, "delivered");
        prompt = await send(a, "", close);
        const confirm = button(prompt, "Да, завершить трек");
        await send(foreign, "", confirm);
        assert.equal((await state(t.id)).status, "delivered", "foreign confirmation is inert");
        const attempts = await Promise.all([send(a, "", confirm), send(a, "", confirm)]);
        const result = attempts.find(r => /Трек .* завершён/.test(r.text))!;
        assert.ok(result, "one concurrent confirmation succeeds");
        assert.match(result.text, /Трек .* завершён/);
        assert.equal((await state(t.id)).status, "completed");
        await send(a, "", confirm);
        await send(a, "", close);
        const audits = await p().query("SELECT actor_user_id,acting_party_id FROM tt_audit_log WHERE transfer_id=$1 AND action='legacy_complete'", [t.id]);
        assert.equal(audits.rowCount, 1);
        assert.equal(audits.rows[0].acting_party_id, a.party);
        assert.equal(audits.rows[0].actor_user_id, a.user ?? null);
        const completedList = await send(a, "Мои передачи");
        assert.ok(!completedList.buttons.some(b => (b.payload ?? b.callback_data) === t.pick));
        const archive = await send(a, "", button(completedList, "Архив"));
        const view = await send(a, "", button(archive, `${t.id} · Завершён`));
        assert.match(view.text, /Статус: Завершён/);
        assert.ok(!view.buttons.some(b => /Передать дальше|Завершить|Ввести код|Запросить код/.test(b.text)));
      });
      it(`${channel}: ${staff ? "staff" : "external"} intermediate holder cannot close; pending/archived/deleted/stale actions are inert`, async () => {
        const a = await actor(channel, staff), intermediate = await seedReceived(a, false);
        const detail = await send(a, "", intermediate.pick);
        assert.ok(!detail.buttons.some(b => b.text === "Завершить трек"));
        assert.match((await send(a, "", buildReceiptEntryCallback("close", intermediate.id, 1)!)).text, /Промежуточный держатель/);
        for (const update of [
          "general_archived_at=NOW()", "deleted_at=NOW()", "handoff_version=2",
          "holder_party_id=creator_party_id", "pending_party_id=creator_party_id,status='waiting'",
          "status='completed'", "row_version=row_version+1",
        ]) {
          const t = await seedReceived(a);
          const prompt = await send(a, "", buildReceiptEntryCallback("close", t.id, 1)!);
          const confirm = button(prompt, "Да, завершить трек");
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [t.id]);
          await send(a, "", confirm);
          assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='legacy_complete'", [t.id])).rows[0].n, 0);
          await send(a, "", button(prompt, "Отмена"));
        }
      });
      it(`${channel}: ${staff ? "staff" : "external"} forwarding preserves an existing draft and rejects stale confirmation`, async () => {
        const a = await actor(channel, staff), t = await seedReceived(a);
        await send(a, "Создать передачу");
        const drafts = await p().query("SELECT id,payload FROM tt_external_request_drafts WHERE confirmed_transfer_id IS NULL ORDER BY created_at DESC LIMIT 1");
        const denied = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        assert.match(denied.text, /незаконченный черновик/);
        assert.deepEqual((await p().query("SELECT id,payload FROM tt_external_request_drafts WHERE id=$1", [drafts.rows[0].id])).rows, drafts.rows);
        await p().query("DELETE FROM tt_external_request_drafts WHERE id=$1", [drafts.rows[0].id]);
        const start = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
        const { summary } = await selectForwardRecipient(a, start);
        await p().query("UPDATE tt_transfers SET row_version=row_version+1 WHERE id=$1", [t.id]);
        await send(a, "", button(summary, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, null);
        assert.equal((await state(t.id)).holder_party_id, a.party);
      });
      it(`${channel}: ${staff ? "staff" : "external"} forward callback and confirmation cannot bypass privacy, identity or current custody`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seedReceived(a);
        const forward = buildReceiptEntryCallback("forward", t.id, 1)!;
        await send(foreign, "", forward);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_external_request_drafts WHERE payload->'holderAction'->>'transferId'=$1", [t.id])).rows[0].n, 0);
        const start = await send(a, "", forward);
        const { summary } = await selectForwardRecipient(a, start);
        await send(foreign, "", button(summary, "Передать дальше"));
        assert.equal((await state(t.id)).pending_party_id, null);
        await send(a, "", button(summary, "Передать дальше"), { privateDialog: false });
        assert.equal((await state(t.id)).pending_party_id, null);
        await send(a, "", button(summary, "Отмена"));
        for (const update of [
          "general_archived_at=NOW()", "deleted_at=NOW()", "handoff_version=2",
          "holder_party_id=creator_party_id", "pending_party_id=creator_party_id,status='waiting'", "status='completed'",
        ]) {
          const stale = await seedReceived(a);
          const prompt = await send(a, "", buildReceiptEntryCallback("forward", stale.id, 1)!);
          const { summary: saved } = await selectForwardRecipient(a, prompt);
          await p().query(`UPDATE tt_transfers SET ${update} WHERE id=$1`, [stale.id]);
          await send(a, "", button(saved, "Передать дальше"));
          assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='holder_pending_change'", [stale.id])).rows[0].n, 0);
          await send(a, "", button(saved, "Отмена"));
        }
        const bound = await seedReceived(a);
        const { summary: saved } = await selectForwardRecipient(a,
          await send(a, "", buildReceiptEntryCallback("forward", bound.id, 1)!));
        if (staff) {
          const table = channel === "max" ? "tanbot_max_accounts" : "tanbot_telegram_accounts";
          await p().query(`UPDATE ${table} SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
        } else {
          await p().query(`DELETE FROM tt_external_person_verifications
            WHERE person_id=(SELECT id FROM tt_external_persons WHERE party_id=$1)`, [a.party]);
        }
        await send(a, "", button(saved, "Передать дальше"));
        assert.equal((await state(bound.id)).pending_party_id, null);
      });
      if (!staff) it(`${channel}: external forwards by phone to new or existing staff while preserving current custody`, async () => {
        const a = await actor(channel, false), creator = await actor(channel, true), other = await actor(channel, true);
        const creatorPhone = `+7977${String(++seq).padStart(7, "0")}`;
        const otherPhone = `+7977${String(++seq).padStart(7, "0")}`;
        await p().query("UPDATE users SET phone=$2 WHERE id=$1", [creator.user, creatorPhone]);
        await p().query("UPDATE users SET phone=$2 WHERE id=$1", [other.user, otherPhone]);
        for (const [recipient, recipientPhone] of [[other, otherPhone], [creator, creatorPhone]] as const) {
          const t = await seedReceived(a);
          await p().query("UPDATE tt_transfers SET creator_party_id=$2 WHERE id=$1", [t.id, creator.party]);
          const before = await state(t.id);
          const start = await send(a, "", buildReceiptEntryCallback("forward", t.id, 1)!);
          assert.match(start.text, /Передать дальше/);
          let reply = await send(a, recipientPhone);
          reply = await send(a, "Synthetic recipient name must not overwrite staff");
          await send(a, "", button(reply, "Передать дальше"));
          const after = await state(t.id);
          assert.equal(after.pending_party_id, recipient.party, "phone selects the canonical employee account");
          assert.equal(after.holder_party_id, a.party, "custody still requires the recipient OTP");
          assert.equal(after.final_recipient_party_id, before.final_recipient_party_id);
          assert.equal((await p().query("SELECT display_name FROM tt_parties WHERE id=$1", [recipient.party])).rows[0].display_name,
            "Synthetic sender");
          assert.equal((await p().query(
            "SELECT COUNT(*)::int AS n FROM tt_parties WHERE kind='external' AND phone_e164=$1", [recipientPhone],
          )).rows[0].n, 0, "no external shadow is created for an employee");
        }
      });
      it(`${channel}: ${staff ? "staff" : "external"} holder refreshes invitation without creating a new track; foreign and stale callbacks cannot`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seed(a);
        const other = await seed(a);
        await send(a, "", other.callback);
        const callback = buildReceiptEntryCallback("invite", t.id, 1)!;
        const before = (await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n;
        const event = ++seq;
        const response = await send(a, "", callback, event);
        assert.match(response.text, /Получить код в MAX/);
        assert.match(response.text, /Получить код в Telegram/);
        assert.doesNotMatch(response.text, /\/tan-tracker\/recipient/);
        assert.equal((await p().query(`SELECT * FROM tt_bot_receipt_code_entries
          WHERE channel=$1 AND messenger_chat_id=$2`, [channel, String(a.chat)])).rowCount, 0);
        assert.ok(response.messages?.[0]?.buttons.some(b => (b.callback_data ?? b.payload) === t.callback));
        const sessions = () => p().query("SELECT id,superseded_at FROM tt_external_messenger_sessions WHERE transfer_id=$1", [t.id]);
        assert.equal((await sessions()).rowCount, 1);
        await send(a, "", callback, event);
        assert.equal((await sessions()).rowCount, 1, "webhook retry must not mint a second invitation");
        await send(a, "", callback);
        assert.equal((await sessions()).rowCount, 2);
        assert.equal((await sessions()).rows.filter(r => !r.superseded_at).length, 1);
        const rejected = await send(foreign, "", callback);
        assert.match(rejected.text, /устарела|недоступна/);
        assert.equal((await sessions()).rowCount, 2);
        await p().query("UPDATE tt_transfers SET handoff_version=2 WHERE id=$1", [t.id]);
        assert.match((await send(a, "", callback)).text, /устарела/);
        assert.equal((await sessions()).rowCount, 2);
        assert.equal((await p().query("SELECT COUNT(*)::int AS n FROM tt_transfers")).rows[0].n, before);
        assert.equal((await p().query("SELECT consumed_at FROM tt_handoff_codes WHERE transfer_id=$1", [t.id])).rows[0].consumed_at, null);
      });
      it(`${channel}: ${staff ? "staff" : "external"} retries expired code without leaving input or confirming custody`, async () => {
        const a = await actor(channel, staff), foreign = await actor(channel, staff), t = await seed(a);
        const first = await send(a, "", t.callback);
        const retry = first.buttons.find(b => b.text === "Запросить код повторно")!;
        const callback = retry.payload ?? retry.callback_data;
        assert.ok(callback);
        await p().query(`UPDATE tt_handoff_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        const expired = await send(a, code);
        assert.match(expired.text, /Срок кода истёк/);
        assert.ok(expired.buttons.some(b => (b.payload ?? b.callback_data) === callback));
        assert.doesNotMatch(expired.text, /ГОТОВО ✅/);
        const event = ++seq;
        const response = await send(a, "", callback, event);
        assert.match(response.messages![0].text, /^Дождитесь кода от получателя\./);
        assert.deepEqual(response.messages![0].buttons.map(b => b.text), ["Запросить код повторно", "Отменить ввод кода"]);
        assert.match(response.messages![0].text, /Перешлите получателю следующее сообщение/);
        assert.match(response.text, /Получить код в MAX|Получить код в Telegram/);
        assert.equal((await entries(a))[0].transfer_id, t.id, "input stays on this transfer");
        const sessions = () => p().query(`SELECT id FROM tt_external_messenger_sessions WHERE transfer_id=$1`, [t.id]);
        assert.equal((await sessions()).rowCount, 1);
        await send(a, "", callback, event);
        assert.equal((await sessions()).rowCount, 1, "duplicate webhook cannot mint twice");
        assert.match((await send(foreign, "", callback)).text, /устарела|недоступна/);
        assert.equal((await sessions()).rowCount, 1);
        const after = await state(t.id);
        assert.equal(after.holder_party_id, a.party);
        assert.equal(after.successes, 0);
        assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_handoff_codes WHERE transfer_id=$1 AND consumed_at IS NULL`, [t.id])).rows[0].n, 0, "sender retry does not issue OTP");
        await p().query(`UPDATE tt_transfers SET handoff_version=2 WHERE id=$1`, [t.id]);
        assert.match((await send(a, "", callback)).text, /устарела/);
        assert.equal((await sessions()).rowCount, 1);
      });
      it(`${channel}: ${staff ? "staff" : "verified external holder"} list pick code OTP confirms once`, async () => {
        const a = await actor(channel, staff), t = await seed(a);
        const selected = await pickTransferAndEnterCode(a, t);
        assert.ok(selected.text.includes(t.id)); assert.match(selected.text, /Synthetic sender/);
        assert.match(selected.text, /Synthetic recipient/);
        assert.match(selected.text, /^Дождитесь кода от получателя\./);
        assert.deepEqual(selected.buttons.map(b => b.text), ["Запросить код повторно", "Отменить ввод кода"]);
        assert.match(selected.text, /6 цифр|сообщение с кодом/);
        assert.equal((await state(t.id)).holder_party_id, a.party);
        const waiting = (await entries(a))[0]; assert.equal(waiting.transfer_id, t.id);
        assert.ok(!JSON.stringify(waiting).includes(code), "selected state stores no raw OTP");
        const messageId = ++seq;
        const done = await send(a, `Передача ${t.id}\nКод приёма: ${code}\nОт: Synthetic sender\nКому: Synthetic recipient`, undefined, messageId);
        assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
        assert.match(done.text, /Статус: Получение подтверждено\nОтветственный: Synthetic recipient/);
        assert.doesNotMatch(done.text, /Статус: Завершена|Ответственный: Synthetic sender/);
        const s = await state(t.id);
        assert.equal(s.holder_party_id, t.recipient); assert.equal(s.pending_party_id, null);
        assert.equal(s.handoff_version, 2); assert.equal(s.status, "delivered"); assert.equal(s.successes, 1);
        assert.equal((await entries(a)).length, 0);
        await send(a, code, undefined, messageId); // exact webhook duplicate
        const replay = await send(a, code);
        assert.match(replay.text, /Сначала.*Мои передачи/);
        assert.equal((await state(t.id)).successes, 1);
        assert.match((await send(a, "", t.callback)).text, /устарела|недоступна/);
      });
    }
    it(`${channel}: unscoped, ambiguous and foreign-track codes never count attempts or infer a transfer`, async () => {
      const a = await actor(channel), t = await seed(a);
      assert.match((await send(a, code)).text, /Сначала.*Мои передачи/);
      assert.equal((await state(t.id)).attempts, 0);
      await send(a, "", t.callback);
      await send(a, `Передача ${t.id}`);
      assert.match((await send(a, "Код: 111111\nКод: 222222")).text, /несколько/);
      assert.match((await send(a, `Передача TT-2026-999999\nКод: ${code}`)).text, /другой трек/);
      assert.equal((await state(t.id)).attempts, 0);
      assert.equal((await state(t.id)).holder_party_id, a.party);
    });
    it(`${channel}: failed attempts COMMIT, never reset by reopening and lock code at the same LK limit`, async () => {
      const a = await actor(channel), t = await seed(a);
      for (let attempt = 1; attempt <= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS; attempt++) {
        await pickTransferAndEnterCode(a, t);
        const reply = await send(a, "111111");
        assert.match(reply.text, attempt === HANDOFF_CODE_MAX_VERIFY_ATTEMPTS ? /Превышено/ : /Неверный код/);
        const s = await state(t.id); assert.equal(s.attempts, attempt); assert.equal(s.holder_party_id, a.party);
      }
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      assert.ok((await p().query(`SELECT consumed_at FROM tt_handoff_codes WHERE transfer_id=$1`, [t.id])).rows[0].consumed_at);
      assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id=$1 AND action='code_verify_fail'`,
        [t.id])).rows[0].n, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS);
      await p().query(`INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
        VALUES($1,1,$2,$3,NOW()+INTERVAL '30 minutes')`, [t.id, t.recipient, hashOtp("456789", requireHandoffOtpPepper())]);
      assert.match((await send(a, "45-67-89")).text, /^ГОТОВО ✅\n\nВы передали/);
      assert.equal((await state(t.id)).successes, 1);
    });
    it(`${channel}: expiry, version, recipient, deletion, archive and status changes cannot be bypassed`, async () => {
      const a = await actor(channel);
      for (const change of ["entry-expired", "code-expired", "consumed", "version", "recipient", "holder", "deleted", "archived", "status"]) {
        const t = await seed(a); await send(a, "", t.callback);
        if (change === "entry-expired") await p().query(`UPDATE tt_bot_receipt_code_entries SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        if (change === "code-expired") await p().query(`UPDATE tt_handoff_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE transfer_id=$1`, [t.id]);
        if (change === "consumed") await p().query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE transfer_id=$1`, [t.id]);
        if (change === "version") await p().query(`UPDATE tt_transfers SET handoff_version=handoff_version+1 WHERE id=$1`, [t.id]);
        if (change === "holder") await p().query(`UPDATE tt_transfers SET holder_party_id=pending_party_id WHERE id=$1`, [t.id]);
        if (change === "recipient") {
          // Even a newly issued, accidentally equal code for a replaced recipient cannot reuse the old selection.
          await p().query(`UPDATE tt_transfers SET pending_party_id=holder_party_id WHERE id=$1`, [t.id]);
          await p().query(`UPDATE tt_handoff_codes SET pending_party_id=$2 WHERE transfer_id=$1`, [t.id, a.party]);
        }
        if (change === "deleted") await p().query(`UPDATE tt_transfers SET deleted_at=NOW() WHERE id=$1`, [t.id]);
        if (change === "archived") await p().query(`UPDATE tt_transfers SET general_archived_at=NOW() WHERE id=$1`, [t.id]);
        if (change === "status") await p().query(`UPDATE tt_transfers SET status='completed' WHERE id=$1`, [t.id]);
        await send(a, code);
        const s = await state(t.id);
        assert.equal(s.holder_party_id, change === "holder" ? t.recipient : a.party, change);
        assert.equal(s.successes, 0, change);
      }
    });
    it(`${channel}: foreign actor, revoked binding, disabled user and nonprivate dialog expose no transfer data`, async () => {
      const a = await actor(channel), other = await actor(channel), t = await seed(a);
      const denied = await send(other, "", t.callback);
      assert.doesNotMatch(denied.text, /Synthetic receipt item|Synthetic sender|Synthetic recipient/);
      assert.equal((await entries(other)).length, 0);
      await send(a, "", t.callback);
      await p().query(`UPDATE users SET status='disabled' WHERE id=$1`, [a.user]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE users SET status='active' WHERE id=$1`, [a.user]);
      await send(a, "", t.callback);
      const prefix = channel === "max" ? "max" : "telegram";
      await p().query(`UPDATE tanbot_${prefix}_accounts SET stopped_at=NOW() WHERE user_id=$1`, [a.user]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET stopped_at=NULL WHERE user_id=$1`, [a.user]);
      await send(a, "", t.callback);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET ${prefix}_user_id=$2 WHERE user_id=$1`, [a.user, String(a.id + 9000000)]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      await p().query(`UPDATE tanbot_${prefix}_accounts SET ${prefix}_user_id=$2 WHERE user_id=$1`, [a.user, String(a.id)]);
      const client = await p().connect();
      try {
        await client.query("BEGIN");
        const r = channel === "max"
          ? await tryNativeCreateMaxCallback(client, { chatId: BigInt(a.chat), maxUserId: BigInt(a.id), payload: t.callback, recipientChatType: "chat" })
          : await tryNativeCreateTelegramCallback(client, { chatId: BigInt(a.chat), telegramUserId: BigInt(a.id), data: t.callback, privateDialogOk: false });
        assert.doesNotMatch(r?.text ?? "", /Synthetic receipt item|Synthetic sender|Synthetic recipient/);
        await client.query("COMMIT");
      } finally { client.release(); }
    });
    it(`${channel}: switching transfers is explicit; stale cancel cannot cancel a newer selection`, async () => {
      const a = await actor(channel), one = await seed(a), two = await seed(a);
      const first = await send(a, "", one.callback);
      const cancel = first.buttons.find(b => /Отменить ввод/.test(b.text))!;
      await send(a, "", two.callback);
      assert.match((await send(a, "", cancel.payload ?? cancel.callback_data)).text, /устарела/);
      assert.equal((await entries(a))[0].transfer_id, two.id);
      const done = await send(a, code);
      assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
      assert.equal((await state(two.id)).successes, 1);
      assert.equal((await state(one.id)).successes, 0);
      await send(a, "", one.callback);
      await send(a, "", two.callback); // delivered transfer: failed selection must not keep One selected
      assert.equal((await entries(a)).length, 0);
      assert.match((await send(a, code)).text, /Сначала.*Мои передачи/);
      assert.equal((await state(one.id)).successes, 0);
    });
    it(`${channel}: concurrent correct-code webhook updates produce one handoff, one success audit`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "", t.callback);
      // Competing synthetic webhook requests exercise transaction locks, not external services.
      await Promise.all([send(a, code), send(a, code)]);
      const s = await state(t.id);
      assert.equal(s.successes, 1); assert.equal(s.handoff_version, 2); assert.equal(s.holder_party_id, t.recipient);
      assert.equal((await p().query(`SELECT COUNT(*)::int AS n FROM tt_transfer_timeline
        WHERE transfer_id=$1 AND note='Подтверждено одноразовым кодом'`, [t.id])).rows[0].n, 1);
    });
    it(`${channel}: removed external verification cannot reuse an active code-entry selection`, async () => {
      const a = await actor(channel, false), t = await seed(a);
      await send(a, "", t.callback);
      await p().query(`DELETE FROM tt_external_person_verifications WHERE channel=$1 AND messenger_user_id=$2`,
        [channel, String(a.id)]);
      await send(a, code);
      assert.equal((await state(t.id)).successes, 0);
      assert.equal((await state(t.id)).holder_party_id, a.party);
    });
    it(`${channel}: cancel and menu clear code selection without changing a creation draft`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "Оформить передачу"); await send(a, "Unrelated unfinished item");
      const snapshot = async () => (await p().query(`SELECT id,step,payload,updated_at FROM tt_external_request_drafts
        WHERE payload->>'staffUserId'=$1`, [a.user])).rows;
      const before = await snapshot(); assert.equal(before.length, 1);
      for (const control of ["Отмена", "Меню", "/start", "Мои передачи", "/code"]) {
        await send(a, "", t.callback); await send(a, control);
        assert.equal((await entries(a)).length, 0, control);
        assert.deepEqual(await snapshot(), before, control);
      }
      assert.equal((await state(t.id)).successes, 0);
    });
    it(`${channel}: sender can enter the issued OTP after the invite is opened in another bot`, async () => {
      const a = await actor(channel), t = await seed(a);
      await send(a, "", t.callback);
      const previous = process.env.TT_EXTERNAL_MESSENGER_ENABLED;
      process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
      const client = await p().connect();
      try {
        await client.query("BEGIN");
        const minted = await mintExternalMessengerSession(client, {
          transferId: t.id, pendingPartyId: t.recipient, handoffVersion: 1,
        });
        assert.ok(minted);
        const session = (await client.query<ExternalMessengerSessionRow>(
          "SELECT * FROM tt_external_messenger_sessions WHERE id=$1::uuid", [minted.sessionId],
        )).rows[0];
        await bindSessionMessengerChat(client, session, channel === "max" ? "telegram" : "max", BigInt(++seq), BigInt(seq));
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally {
        client.release();
        if (previous === undefined) delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
        else process.env.TT_EXTERNAL_MESSENGER_ENABLED = previous;
      }
      const done = await send(a, code);
      assert.match(done.text, /^ГОТОВО ✅\n\nВы передали/);
      assert.equal((await state(t.id)).successes, 1);
    });
    it(`${channel}: paged holder-only code choices keep older transfers accessible without a website`, async () => {
      const a = await actor(channel), other = await actor(channel);
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await seed(a)).id);
      const foreign = await seed(other);
      const first = await send(a, "Мои передачи");
      const choices = first.buttons.filter(b => /^TT-/u.test(b.text));
      assert.equal(choices.length, 5);
      const next = first.buttons.find(b => /Следующие передачи/.test(b.text))!;
      assert.ok(next);
      const second = await send(a, "", next.payload ?? next.callback_data);
      const rest = second.buttons.filter(b => /^TT-/u.test(b.text));
      assert.equal(rest.length, 2);
      const shown = [...choices, ...rest].map(b => parseReceiptEntryCallback(b.payload ?? b.callback_data ?? "")!.transferId);
      assert.deepEqual([...shown].sort(), ids.sort()); assert.ok(!shown.includes(foreign.id));
    });
    for (const role of ["rop", "regional_manager"]) {
      it(`${channel}: ${role} status uses the canonical 1C team scope and rechecks membership`, async () => {
        const leader = await actor(channel, true), member = await actor(channel, true), outsider = await actor(channel, true);
        await p().query("UPDATE users SET role=$2 WHERE id=$1", [leader.user, role]);
        await p().query("UPDATE users SET role='manager' WHERE id=ANY($1::uuid[])", [[member.user, outsider.user]]);
        const leaderGuid = randomUUID(), memberGuid = randomUUID(), teamGuid = randomUUID();
        await p().query(`INSERT INTO onec_wholesale_employee_roster(guid_manager,name_manager,post,raw_json)
          VALUES($1,'Synthetic leader','Manager','{}'),($2,'Synthetic member','Manager','{}')`, [leaderGuid, memberGuid]);
        await p().query(`INSERT INTO onec_wholesale_team_groups(guid_team,name_team,guid_team_leader,name_team_leader)
          VALUES($1,'Synthetic status team',$2,'Synthetic leader')`, [teamGuid, leaderGuid]);
        await p().query(`INSERT INTO onec_wholesale_employee_team_memberships(guid_team,guid_manager,name_team)
          VALUES($1,$2,'Synthetic status team')`, [teamGuid, memberGuid]);
        await linkUserToEmployee({ databaseUrl: getIntegrationDatabaseUrl(), userId: leader.user!, employeeId: leaderGuid, confirmedByUserId: outsider.user! });
        await linkUserToEmployee({ databaseUrl: getIntegrationDatabaseUrl(), userId: member.user!, employeeId: memberGuid, confirmedByUserId: outsider.user! });
        const visible = await seed(member), hidden = await seed(outsider);
        const list = await send(leader, "Статус трека");
        assert.ok(list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(visible.id)));
        assert.ok(!list.buttons.some(b => (b.payload ?? b.callback_data) === statusView(hidden.id)));
        assert.match((await send(leader, "", statusView(visible.id))).text, /Текущий держатель: Synthetic sender/);
        assert.match((await send(leader, "", statusView(hidden.id))).text, /не найден или недоступен/);
        // Pool max is five. Every reader already holds a connection; a nested acquisition could starve all readers.
        const concurrent = await Promise.all(Array.from({ length: 6 }, () => withTransaction(client =>
          trackStatusReply(client, {
            channel, messengerUserId: BigInt(leader.id), messengerChatId: String(leader.chat),
            privateDialogOk: true, isLinkedStaff: true, staffUserId: leader.user!, personId: null,
          }, { action: "view", transferId: visible.id }))));
        for (const reply of concurrent) assert.match(reply.text, /Текущий держатель: Synthetic sender/);
        await p().query("DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team=$1", [teamGuid]);
        assert.match((await send(leader, "", statusView(visible.id))).text, /не найден или недоступен/);
      });
    }
  }
  it("MAX selection never authorizes code input in Telegram, even for the same linked staff holder", async () => {
    const max = await actor("max");
    const tg: Actor = { ...max, channel: "telegram", id: ++seq, chat: seq };
    await p().query(`INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id,notifications_enabled)
      VALUES($1,$2,$2,TRUE)`, [max.user, String(tg.id)]);
    const one = await seed(max), two = await seed(max);
    await send(max, "", one.callback);
    assert.match((await send(tg, code)).text, /Сначала/);
    assert.equal((await state(one.id)).successes, 0);
    await send(tg, "", two.callback);
    await send(max, code); await send(tg, code);
    assert.equal((await state(one.id)).successes, 1);
    assert.equal((await state(two.id)).successes, 1);
  });
});
