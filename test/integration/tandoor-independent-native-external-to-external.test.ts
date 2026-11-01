import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { resolvePublicHolderPendingPartyId } from "../../src/tan-tracker/public-holder-eligibility";
import { holderAccessTtlMs, signHolderAccess } from "../../src/tan-tracker/holder-access";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";

type Channel = "max" | "telegram";
type Button = { text: string; payload?: string; callback_data?: string };
type Reply = { text: string; buttons: Button[]; messages?: Reply[] };

const db = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 920000;
let originalFetch: typeof fetch;

async function externalActor(channel: Channel, phone?: string): Promise<{
  channel: Channel; id: number; chatId: number; partyId: string; personId: string; phone: string;
}> {
  const id = ++seq;
  const chatId = channel === "max" ? id + 200000 : id;
  const actorPhone = phone ?? `+7998${String(id).padStart(7, "0")}`;
  const partyId = (await getPool()!.query(
    `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id`,
    [`Ext sender ${id}`, actorPhone],
  )).rows[0].id;
  const personId = randomUUID();
  await getPool()!.query(
    `INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,$3,$4)`,
    [personId, partyId, `Ext sender ${id}`, actorPhone],
  );
  await getPool()!.query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
     VALUES($1,$2,$3,$4)`,
    [personId, channel, String(id), String(chatId)],
  );
  return { channel, id, chatId, partyId, personId, phone: actorPhone };
}

async function send(actor: ReturnType<typeof externalActor> extends Promise<infer T> ? T : never, input: {
  text?: string; callback?: string; phone?: string;
}): Promise<Reply> {
  const id = ++seq;
  const out: Reply[] = [];
  if (actor.channel === "max") {
    const raw = input.callback
      ? {
          update_type: "message_callback", timestamp: id,
          callback: { callback_id: `e2e-${id}`, payload: input.callback, user: { user_id: actor.id, is_bot: false } },
          message: { recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.id }, body: { mid: `e2e-${id}` } },
        }
      : {
          update_type: "message_created", timestamp: id,
          message: {
            sender: { user_id: actor.id, is_bot: false },
            recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: 999000 },
            body: { mid: `e2e-${id}`, text: input.text ?? "" },
          },
        };
    const result = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200);
    const c = loadTanbotMaxStage2Config(); assert.ok(c.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, c.config, async p => {
      out.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `reply-${id}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const raw = input.callback
      ? {
          update_id: id, callback_query: {
            id: `e2e-${id}`, data: input.callback, from: { id: actor.id, is_bot: false },
            message: { message_id: id, chat: { id: actor.chatId, type: "private" } },
          },
        }
      : {
          update_id: id,
          message: {
            message_id: id, from: { id: actor.id, is_bot: false },
            chat: { id: actor.chatId, type: "private" }, text: input.text ?? "",
          },
        };
    const result = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200);
    const c = loadTanbotTelegramStage2Config(); assert.ok(c.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, c.config, async p => {
      if (p.method === "sendMessage") {
        const m = p.body.reply_markup as { inline_keyboard?: Button[][] } | undefined;
        out.push({ text: String(p.body.text), buttons: (m?.inline_keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  }
  assert.ok(out.length);
  return { ...out.at(-1)!, messages: out };
}

function button(r: Reply, pattern: RegExp): string {
  const b = r.buttons.find(x => pattern.test(x.text));
  assert.ok(b, JSON.stringify(r));
  const data = b.payload ?? b.callback_data;
  assert.ok(data);
  return data;
}

async function draftFor(actor: { channel: Channel; chatId: number }) {
  const key = `native:ext:${actor.channel}:${actor.chatId}`;
  return (await getPool()!.query(
    `SELECT id,step,payload,confirmed_transfer_id FROM tt_external_request_drafts
     WHERE messenger_chat_id=$1 ORDER BY created_at DESC LIMIT 1`, [key],
  )).rows[0];
}

async function wizardToSummary(actor: Awaited<ReturnType<typeof externalActor>>, recipientPhone: string, name: string) {
  let r = await send(actor, { text: "Создать передачу" });
  r = await send(actor, { text: `E2E item ${actor.id}` });
  r = await send(actor, { callback: button(r, /пропустить/iu) });
  r = await send(actor, { callback: button(r, /пропустить/iu) });
  r = await send(actor, { text: recipientPhone });
  r = await send(actor, { text: name });
  r = await send(actor, { callback: button(r, /без срока/iu) });
  return r;
}

function parseMstInvitation(text: string): string {
  const url = (text.match(/https?:\/\/[^\s)]+/g) ?? [])[0];
  assert.ok(url);
  const mst = new URL(url).searchParams.get("mst");
  assert.ok(mst);
  return mst;
}

before(async () => {
  setIntegrationEnv(db, origin);
  Object.assign(process.env, {
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-ext2ext-synthetic-test-token",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_ext2ext_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-ext2ext-telegram-pepper",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-ext2ext-telegram-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false", TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_EXT2EXT_MAX_TOKEN",
    TANBOT_MAX_BOT_USERNAME: "synthetic_ext2ext_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-ext2ext-max-pepper",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-ext2ext-max-secret",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network in ext2ext test"); };
  const { createApp } = await import("../../src/server");
  app = createApp();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await closePool();
});

describe("native external sender to external recipient (both channels)", { concurrency: false }, () => {
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: creates transfer, invitation, verified recipient code, sender receipt`, async () => {
      const sender = await externalActor(channel);
      const recipientPhone = `+7904${String(++seq).padStart(7, "0")}`;
      const recipientName = "Canonical Ext Recipient";
      let summary = await wizardToSummary(sender, recipientPhone, recipientName);
      const confirm = button(summary, /^Создать передачу$/u);
      const created = await send(sender, { callback: confirm });
      const draft = await draftFor(sender);
      assert.ok(draft.confirmed_transfer_id);
      const row = (await getPool()!.query(
        `SELECT t.id,t.holder_party_id::text,t.pending_party_id::text,t.handoff_version,
                p.display_name,p.phone_e164,p.created_by_user_id::text
         FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.id=$1`,
        [draft.confirmed_transfer_id],
      )).rows[0];
      assert.equal(row.holder_party_id, sender.partyId);
      assert.equal(row.display_name, recipientName);
      assert.equal(row.phone_e164, recipientPhone);
      assert.equal(row.created_by_user_id, null);
      assert.equal(row.handoff_version, 1);
      const inviteText =
        created.messages?.map(m => m.text).find(t => /Посмотреть передачу/u.test(t))
        ?? created.messages?.map(m => m.text).join("\n")
        ?? created.text;
      const mst = parseMstInvitation(inviteText);
      const recipientUserId = ++seq;
      let code = "";
      if (channel === "telegram") {
        const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
        const start = await handleTanbotTelegramUpdate(getPool()!, cfg.config, {
          update_id: ++seq,
          message: {
            message_id: 1, chat: { id: recipientUserId, type: "private" },
            from: { id: recipientUserId, is_bot: false }, text: `/start ${mst}`,
          },
        });
        assert.match(start.reply?.text ?? "", /номер/u);
        const contact = await handleTanbotTelegramUpdate(getPool()!, cfg.config, {
          update_id: ++seq,
          message: {
            message_id: 2, chat: { id: recipientUserId, type: "private" },
            from: { id: recipientUserId, is_bot: false },
            contact: { phone_number: recipientPhone, user_id: recipientUserId, first_name: "R" },
          },
        });
        code = (contact.reply?.text ?? "").match(/\b(\d{6})\b/)?.[1] ?? "";
      } else {
        const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
        const vcfRaw =
          `BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:R\\r\\nTEL;TYPE=CELL:${recipientPhone}\\r\\nEND:VCARD`;
        const hash = createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!)
          .update(decodeVcfInfoForHmac(vcfRaw), "utf8").digest("hex");
        await handleTanbotMaxUpdate(getPool()!, cfg.config, {
          update_type: "bot_started", timestamp: ++seq, chat_id: recipientUserId,
          user: { user_id: recipientUserId, is_bot: false, first_name: "R" }, payload: mst,
        });
        const contact = await handleTanbotMaxUpdate(getPool()!, cfg.config, {
          update_type: "message_created", timestamp: ++seq,
          message: {
            sender: { user_id: recipientUserId, is_bot: false, first_name: "R" },
            recipient: { chat_id: recipientUserId },
            body: {
              mid: `contact-${seq}`,
              attachments: [{
                type: "contact",
                payload: { vcf_info: vcfRaw, hash, max_info: { user_id: recipientUserId, first_name: "R" } },
              }],
            },
          },
        });
        code = (contact.reply?.text ?? "").match(/\b(\d{6})\b/)?.[1] ?? "";
      }
      assert.ok(code, "recipient verified phone must receive code");
      const before = (await getPool()!.query(
        `SELECT holder_party_id::text,pending_party_id,handoff_version FROM tt_transfers WHERE id=$1`, [row.id],
      )).rows[0];
      const hat = signHolderAccess({
        transferId: row.id,
        partyId: sender.partyId,
        hv: row.handoff_version,
        exp: Date.now() + holderAccessTtlMs(),
      });
      const verify = await request(app).post("/api/tan-tracker/public/holder/code/verify")
        .set("Origin", origin).send({ holderAccessToken: hat, code });
      assert.equal(verify.status, 200, verify.text);
      const after = (await getPool()!.query(
        `SELECT holder_party_id::text,pending_party_id,handoff_version FROM tt_transfers WHERE id=$1`, [row.id],
      )).rows[0];
      assert.equal(after.holder_party_id, row.pending_party_id);
      assert.equal(after.pending_party_id, null);
      assert.equal(after.handoff_version, before.handoff_version + 1);
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tanbot_notification_outbox
          WHERE event_type='tan_tracker.external_created' AND payload->>'publicCode'=$1`, [row.id])).rows[0].n,
        0,
        "external-to-external must not enqueue staff intake notification",
      );
    });

    it(`${channel}: reuses existing external party without rename`, async () => {
      const existingPhone = `+7905${String(++seq).padStart(7, "0")}`;
      const existingParty = (await getPool()!.query(
        `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Stable Existing Name',$1) RETURNING id`,
        [existingPhone],
      )).rows[0].id;
      const sender = await externalActor(channel);
      const summary = await wizardToSummary(sender, existingPhone, "Attempted Rename");
      await send(sender, { callback: button(summary, /^Создать передачу$/u) });
      const draft = await draftFor(sender);
      const pending = (await getPool()!.query(`SELECT pending_party_id::text FROM tt_transfers WHERE id=$1`, [
        draft.confirmed_transfer_id,
      ])).rows[0].pending_party_id;
      assert.equal(pending, existingParty);
      assert.equal(
        (await getPool()!.query(`SELECT display_name FROM tt_parties WHERE id=$1`, [existingParty])).rows[0].display_name,
        "Stable Existing Name",
      );
    });

    it(`${channel}: self recipient and employee collision roll back with draft preserved`, async () => {
      const sender = await externalActor(channel);
      const before = (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1::uuid`, [
        sender.partyId,
      ])).rows[0].n;
      let summary = await wizardToSummary(sender, sender.phone, "Self Target");
      let r = await send(sender, { callback: button(summary, /^Создать передачу$/u) });
      assert.match(r.text, /себ|получател/iu);
      assert.equal((await draftFor(sender)).confirmed_transfer_id, null);
      const emp = await createTestUser({
        databaseUrl: db, email: `ext2ext-emp-${seq}@test.local`, password: "StrongPass123!",
        fullName: "Hidden Employee", role: "manager",
      });
      const empPhone = `+7906${String(++seq).padStart(7, "0")}`;
      await ensurePartyForUserOnWrite(getPool()!, emp.id, "Hidden Employee", empPhone);
      summary = await wizardToSummary(sender, empPhone, "Should Fail");
      r = await send(sender, { callback: button(summary, /^Создать передачу$/u) });
      assert.match(r.text, /сотрудник|личный кабинет/iu);
      assert.doesNotMatch(r.text, /Hidden Employee/u);
      assert.equal((await draftFor(sender)).confirmed_transfer_id, null);
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1::uuid`, [
          sender.partyId,
        ])).rows[0].n,
        before,
      );
    });

    it(`${channel}: concurrent confirm creates one transfer`, async () => {
      const sender = await externalActor(channel);
      const phone = `+7907${String(++seq).padStart(7, "0")}`;
      const summary = await wizardToSummary(sender, phone, "Once Only");
      const confirm = button(summary, /^Создать передачу$/u);
      await Promise.all([
        request(app).post(channel === "telegram" ? "/api/tanbot-telegram/webhook" : "/api/tanbot-max/webhook")
          .set(channel === "telegram" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Max-Bot-Api-Secret",
            channel === "telegram" ? process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET! : process.env.TANBOT_MAX_WEBHOOK_SECRET!)
          .send(channel === "telegram"
            ? { update_id: ++seq, callback_query: { id: "p1", data: confirm, from: { id: sender.id, is_bot: false },
                message: { message_id: 1, chat: { id: sender.chatId, type: "private" } } } }
            : { update_type: "message_callback", timestamp: ++seq,
                callback: { callback_id: "p1", payload: confirm, user: { user_id: sender.id, is_bot: false } },
                message: { recipient: { chat_id: sender.chatId, chat_type: "dialog", user_id: sender.id }, body: { mid: "p1" } } }),
        request(app).post(channel === "telegram" ? "/api/tanbot-telegram/webhook" : "/api/tanbot-max/webhook")
          .set(channel === "telegram" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Max-Bot-Api-Secret",
            channel === "telegram" ? process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET! : process.env.TANBOT_MAX_WEBHOOK_SECRET!)
          .send(channel === "telegram"
            ? { update_id: ++seq, callback_query: { id: "p2", data: confirm, from: { id: sender.id, is_bot: false },
                message: { message_id: 2, chat: { id: sender.chatId, type: "private" } } } }
            : { update_type: "message_callback", timestamp: ++seq,
                callback: { callback_id: "p2", payload: confirm, user: { user_id: sender.id, is_bot: false } },
                message: { recipient: { chat_id: sender.chatId, chat_type: "dialog", user_id: sender.id }, body: { mid: "p2" } } }),
      ]);
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1::uuid AND item_title=$2`, [
          sender.partyId, `E2E item ${sender.id}`,
        ])).rows[0].n,
        1,
      );
    });
  }

  it("nullable creator allows external holder next external handoff by phone", async () => {
    const pool = getPool()!;
    const senderParty = (await pool.query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Holder ext','+79990001001') RETURNING id`,
    )).rows[0].id;
    const recipientParty = (await pool.query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Final ext','+79990001002') RETURNING id`,
    )).rows[0].id;
    const transferId = (await pool.query(
      `INSERT INTO tt_transfers(id,public_code,item_title,status,from_external,creator_party_id,holder_party_id,
        pending_party_id,final_recipient_party_id,handoff_version)
       VALUES($1,$1,'Handoff chain','waiting',TRUE,$2,$2,NULL,$3,2) RETURNING id`,
      [`TT-E2E-${++seq}`, senderParty, recipientParty],
    )).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const nextPhone = "+79990001003";
      const nextId = await resolvePublicHolderPendingPartyId(client, transferId, senderParty, undefined, {
        name: "Next External", phone: nextPhone,
      });
      await client.query("ROLLBACK");
      assert.notEqual(nextId, senderParty);
      const party = (await pool.query(`SELECT phone_e164,created_by_user_id FROM tt_parties WHERE id=$1`, [nextId])).rows[0];
      assert.equal(party.phone_e164, nextPhone);
      assert.equal(party.created_by_user_id, null);
    } finally {
      client.release();
    }
  });
});
