import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { ensureNativeBotDraft, bumpDraftRevision } from "../../src/tanbot/native-create/draft-scope";
import {
  buildTelegramNativeCreateContext,
  tryNativeCreateTelegramContact,
} from "../../src/tanbot/native-create/adapters";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import crypto from "node:crypto";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";

const databaseUrl = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
const MAX_BOT_TOKEN = "SYNTHETIC_MAX_TEST_TOKEN_0123456789abcdef";

type Channel = "telegram" | "max";
type Button = { text: string; callback_data?: string; payload?: string };
type Reply = { text: string; buttons: Button[] };
type Actor = { channel: Channel; messengerId: number; chatId: number; staffId: string; partyId: string };

let app: ReturnType<typeof import("../../src/server").createApp>;
let sequence = 9_200_000;

function unsignedMaxVcf(name: string, phone: string): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${name}`,
    `TEL;TYPE=CELL:${phone}`,
    "END:VCARD",
  ].join("\\r\\n");
}

function signedMaxVcf(phone: string, maxUserId: number): { vcfRaw: string; hash: string } {
  const vcfRaw = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Own",
    `TEL;TYPE=CELL:${phone}`,
    "END:VCARD",
  ].join("\\r\\n");
  const hash = crypto.createHmac("sha256", MAX_BOT_TOKEN).update(decodeVcfInfoForHmac(vcfRaw), "utf8").digest("hex");
  return { vcfRaw, hash };
}

async function drainTelegram(sends: Reply[], id: number): Promise<void> {
  const loaded = loadTanbotTelegramStage2Config();
  assert.ok(loaded.ok);
  const transport: TelegramDeliveryTransport = async input => {
    if (input.method === "sendMessage") {
      const markup = input.body.reply_markup as { inline_keyboard?: Button[][] } | undefined;
      sends.push({ text: String(input.body.text), buttons: (markup?.inline_keyboard ?? []).flat() });
    }
    return { ok: true, result: { message_id: id } };
  };
  await processUndeliveredTelegramWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
}

async function drainMax(sends: Reply[], actor: Actor, id: number): Promise<void> {
  const loaded = loadTanbotMaxStage2Config();
  assert.ok(loaded.ok);
  const transport: MaxDeliveryTransport = async input => {
    assert.equal(input.userId, BigInt(actor.messengerId));
    sends.push({ text: input.text, buttons: input.inlineButtons?.flat() ?? [] });
    return { ok: true, result: { message: { body: { mid: `recorded-${id}` } } } };
  };
  await processUndeliveredMaxWebhookReplies(getPool()!, loaded.config, transport, { deliveryEnabled: true });
}

async function send(
  actor: Actor,
  input:
    | { kind: "text"; text: string }
    | { kind: "callback"; data: string }
    | { kind: "tg_contact"; phone: string; firstName?: string; lastName?: string; contactUserId?: number; vcard?: string }
    | { kind: "max_unsigned_vcf"; vcfRaw: string; chatType?: string }
    | { kind: "max_signed_contact"; vcfRaw: string; hash: string; contactUserId: number },
  options: { skipDrain?: boolean } = {},
): Promise<Reply> {
  const id = ++sequence;
  const sends: Reply[] = [];
  if (actor.channel === "telegram") {
    let body: Record<string, unknown>;
    if (input.kind === "callback") {
      body = {
        update_id: id,
        callback_query: {
          id: `native-rc-${id}`,
          data: input.data,
          from: { id: actor.messengerId, is_bot: false },
          message: { message_id: id, chat: { id: actor.chatId, type: "private" } },
        },
      };
    } else if (input.kind === "tg_contact") {
      body = {
        update_id: id,
        message: {
          message_id: id,
          from: { id: actor.messengerId, is_bot: false, first_name: "Staff" },
          chat: { id: actor.chatId, type: "private" },
          contact: {
            phone_number: input.phone,
            first_name: input.firstName ?? "Card",
            last_name: input.lastName ?? "",
            user_id: input.contactUserId ?? 42424242,
            ...(input.vcard ? { vcard: input.vcard } : {}),
          },
        },
      };
    } else {
      body = {
        update_id: id,
        message: {
          message_id: id,
          from: { id: actor.messengerId, is_bot: false, first_name: "Staff" },
          chat: { id: actor.chatId, type: "private" },
          text: input.text,
        },
      };
    }
    const response = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send(body);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (!options.skipDrain) await drainTelegram(sends, id);
  } else {
    let payload: Record<string, unknown>;
    if (input.kind === "callback") {
      payload = {
        update_type: "message_callback",
        timestamp: id,
        callback: { callback_id: `native-rc-${id}`, payload: input.data, user: { user_id: actor.messengerId, is_bot: false } },
        message: {
          recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.messengerId },
          body: { mid: `native-rc-${id}` },
        },
      };
    } else if (input.kind === "max_unsigned_vcf") {
      payload = {
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false, first_name: "Staff" },
          recipient: {
            chat_id: actor.chatId,
            chat_type: input.chatType ?? "dialog",
            user_id: actor.messengerId,
          },
          body: {
            mid: `native-rc-${id}`,
            attachments: [{ type: "contact", payload: { vcf_info: input.vcfRaw } }],
          },
        },
      };
    } else if (input.kind === "max_signed_contact") {
      payload = {
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false, first_name: "Staff" },
          recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.messengerId },
          body: {
            mid: `native-rc-${id}`,
            attachments: [
              {
                type: "contact",
                payload: {
                  vcf_info: input.vcfRaw,
                  max_info: { user_id: input.contactUserId, first_name: "Own" },
                  hash: input.hash,
                },
              },
            ],
          },
        },
      };
    } else {
      payload = {
        update_type: "message_created",
        timestamp: id,
        message: {
          sender: { user_id: actor.messengerId, is_bot: false, first_name: "Staff" },
          recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.messengerId },
          body: { mid: `native-rc-${id}`, text: input.text },
        },
      };
    }
    const response = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send(payload);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (!options.skipDrain) await drainMax(sends, actor, id);
  }
  if (options.skipDrain) return { text: "", buttons: [] };
  assert.ok(sends.length, "expected a delivered bot reply");
  return sends.at(-1)!;
}

function action(reply: Reply, label: RegExp): string {
  const found = reply.buttons.find(b => label.test(b.text));
  assert.ok(found, `Missing button ${label}: ${JSON.stringify(reply)}`);
  const value = found.callback_data ?? found.payload;
  assert.ok(value);
  return value;
}

async function staffActor(channel: Channel, chatOffset = 0): Promise<Actor> {
  const index = ++sequence;
  const messengerId = index;
  const chatId = channel === "telegram" ? messengerId : messengerId + 100000 + chatOffset;
  const pool = getPool()!;
  const user = await createTestUser({
    databaseUrl,
    email: `native-rc-${channel}-${index}@test.local`,
    password: "StrongPass123!",
    fullName: `Staff RC ${channel}`,
    role: "admin",
  });
  const party = await ensurePartyForUserOnWrite(pool, user.id, `Staff RC ${channel}`, null);
  const table = channel === "telegram" ? "tanbot_telegram_accounts" : "tanbot_max_accounts";
  const prefix = channel === "telegram" ? "telegram" : "max";
  await pool.query(
    `INSERT INTO ${table}(user_id,${prefix}_user_id,${prefix}_chat_id,notifications_enabled)
     VALUES($1,$2,$3,TRUE)`,
    [user.id, String(messengerId), String(chatId)],
  );
  return { channel, messengerId, chatId, staffId: user.id, partyId: party.id };
}

async function draftPayload(staffId: string): Promise<Record<string, unknown>> {
  const row = await getPool()!.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM tt_external_request_drafts
     WHERE payload->>'staffUserId' = $1 AND confirmed_transfer_id IS NULL LIMIT 1`,
    [staffId],
  );
  return row.rows[0]?.payload ?? {};
}

async function draftStep(staffId: string): Promise<string | undefined> {
  const row = await getPool()!.query<{ step: string }>(
    `SELECT step FROM tt_external_request_drafts
     WHERE payload->>'staffUserId' = $1 AND confirmed_transfer_id IS NULL LIMIT 1`,
    [staffId],
  );
  return row.rows[0]?.step;
}

async function reachRecipientStep(actor: Actor): Promise<Reply> {
  let reply = await send(actor, { kind: "text", text: "Создать передачу" });
  reply = await send(actor, { kind: "text", text: `Item ${actor.messengerId}` });
  reply = await send(actor, { kind: "callback", data: action(reply, /пропустить/iu) });
  reply = await send(actor, { kind: "callback", data: action(reply, /пропустить/iu) });
  assert.match(reply.text, /кому передаёте/i);
  return reply;
}

async function openExternalPhoneStep(actor: Actor, manualName: string, phone = "+79991112233"): Promise<Reply> {
  await reachRecipientStep(actor);
  let reply = await send(actor, { kind: "text", text: phone });
  reply = await send(actor, { kind: "text", text: manualName });
  assert.match(reply.text, /телефон/i);
  return reply;
}

async function openExternalNameStep(actor: Actor): Promise<Reply> {
  const reply = await reachRecipientStep(actor);
  const phone = `+7900${String(actor.messengerId).slice(-7)}`;
  const next = await send(actor, { kind: "text", text: phone });
  assert.match(next.text, /имя/i);
  return next;
}

before(async () => {
  setIntegrationEnv(databaseUrl, origin);
  Object.assign(process.env, {
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-synthetic-test-token-0123456789",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-min16",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-telegram-webhook-secret-min16",
    TANBOT_MAX_ENABLED: "true",
    TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_BOT_TOKEN: MAX_BOT_TOKEN,
    TANBOT_MAX_BOT_USERNAME: "synthetic_test_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-min16",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-max-webhook-secret-min16",
  });
  await prepareDatabase(databaseUrl);
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  app = createApp();
});

after(closePool);

describe("native recipient contact (adapter)", () => {
  it("staff draft phone step — contact sets phone, keeps manual name, no verification side effects", async () => {
    const pool = getPool()!;
    const staff = await createTestUser({
      databaseUrl,
      email: "native-rc-staff@test.local",
      password: "StrongPass123!",
      fullName: "Staff Native RC",
      role: "manager",
    });
    await ensurePartyForUserOnWrite(pool, staff.id, "Staff Native RC", null);
    const tgId = 870001;
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
       VALUES ($1::uuid, $2, $2, TRUE)`,
      [staff.id, tgId],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const draft = await ensureNativeBotDraft(client, {
        channel: "telegram",
        messengerChatId: String(tgId),
        actor: "staff",
        staffUserId: staff.id,
      });
      await bumpDraftRevision(client, draft.id, "recipient_ext_phone", {
        ...(draft.payload as object),
        recipientExternal: { name: "Ручное Имя", phone: "" },
        revision: 2,
      } as never);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const client2 = await pool.connect();
    try {
      const reply = await tryNativeCreateTelegramContact(client2, {
        chatId: BigInt(tgId),
        telegramUserId: BigInt(tgId),
        phoneRaw: "+79991112233",
        contactFirstName: "Чужой",
        contactLastName: "Контакт",
        isForwarded: false,
      });
      assert.ok(reply?.text);
    } finally {
      client2.release();
    }

    const row = await pool.query<{ payload: { recipientExternal?: { name: string; phone: string } } }>(
      `SELECT payload FROM tt_external_request_drafts WHERE payload->>'staffUserId' = $1 LIMIT 1`,
      [staff.id],
    );
    assert.equal(row.rows[0]?.payload.recipientExternal?.name, "Ручное Имя");
    assert.equal(row.rows[0]?.payload.recipientExternal?.phone, "+79991112233");

    const verifications = await pool.query(
      `SELECT 1 FROM tt_external_person_verifications WHERE messenger_user_id = '42424242'`,
    );
    assert.equal(verifications.rowCount, 0);
  });

  it("contact outside wizard step does not mutate draft", async () => {
    const pool = getPool()!;
    const staff = await createTestUser({
      databaseUrl,
      email: "native-rc-staff2@test.local",
      password: "StrongPass123!",
      fullName: "Staff Two",
      role: "manager",
    });
    const tgId = 870002;
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
       VALUES ($1::uuid, $2, $2, TRUE)`,
      [staff.id, tgId],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const draft = await ensureNativeBotDraft(client, {
        channel: "telegram",
        messengerChatId: String(tgId),
        actor: "staff",
        staffUserId: staff.id,
      });
      await bumpDraftRevision(client, draft.id, "item", draft.payload as never);
      await client.query("COMMIT");
      const before = (
        await client.query(`SELECT payload FROM tt_external_request_drafts WHERE id = $1`, [draft.id])
      ).rows[0]!.payload;
      const reply = await tryNativeCreateTelegramContact(client, {
        chatId: BigInt(tgId),
        telegramUserId: BigInt(tgId),
        phoneRaw: "+79992223344",
        contactFirstName: "X",
        isForwarded: false,
      });
      assert.equal(reply, null);
      const after = (
        await client.query(`SELECT payload FROM tt_external_request_drafts WHERE id = $1`, [draft.id])
      ).rows[0]!.payload;
      assert.deepEqual(after, before);
    } finally {
      client.release();
    }
  });
});

describe("native recipient contact (HTTP both channels)", { concurrency: false }, () => {
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: name-first — contact on phone step keeps manual name`, async () => {
      const actor = await staffActor(channel);
      await openExternalPhoneStep(actor, "Сохранённое имя");
      const phone = "+79031112233";
      if (channel === "telegram") {
        await send(actor, {
          kind: "tg_contact",
          phone,
          firstName: "Другой",
          lastName: "Контакт",
          contactUserId: 777001,
        });
      } else {
        await send(actor, { kind: "max_unsigned_vcf", vcfRaw: unsignedMaxVcf("Другой Контакт", phone) });
      }
      const payload = await draftPayload(actor.staffId);
      const ext = payload.recipientExternal as { name: string; phone: string };
      assert.equal(ext.name, "Сохранённое имя");
      assert.equal(ext.phone, phone);
      assert.equal(payload.recipientPhonePickOptions, undefined);
      const ver = await getPool()!.query(`SELECT 1 FROM tt_external_person_verifications WHERE messenger_user_id = '777001'`);
      assert.equal(ver.rowCount, 0);
    });

    it(`${channel}: contact-first — keep/rename then phone step`, async () => {
      const actor = await staffActor(channel);
      const phone = "+79032223344";
      let reply = await openExternalNameStep(actor);
      if (channel === "telegram") {
        reply = await send(actor, { kind: "tg_contact", phone, firstName: "Иван", lastName: "Карточkin" });
      } else {
        reply = await send(actor, { kind: "max_unsigned_vcf", vcfRaw: unsignedMaxVcf("Иван Карточkin", phone) });
      }
      assert.ok(reply.buttons.some(b => /оставить|изменить/i.test(b.text)));
      const payload = await draftPayload(actor.staffId);
      const ext = payload.recipientExternal as { name: string; phone: string };
      assert.match(ext.name ?? "", /Иван/);
      assert.equal(ext.phone, phone);
      reply = await send(actor, { kind: "callback", data: action(reply, /оставить/i) });
      reply = await send(actor, { kind: "callback", data: action(reply, /Далее/i) });
      assert.equal(await draftStep(actor.staffId), "due");
    });

    it(`${channel}: invalid contact preserves prior draft state`, async () => {
      const actor = await staffActor(channel);
      await openExternalPhoneStep(actor, "Stable Name");
      const before = await draftPayload(actor.staffId);
      if (channel === "telegram") {
        const reply = await send(actor, { kind: "tg_contact", phone: "not-a-phone", firstName: "Bad" });
        assert.match(reply.text, /вручную|не распознан/i);
      } else {
        const reply = await send(actor, {
          kind: "max_unsigned_vcf",
          vcfRaw: "BEGIN:VCARD\\r\\nFN:NoTel\\r\\nEND:VCARD",
        });
        assert.match(reply.text, /нет подходящего|вручную/i);
      }
      const after = await draftPayload(actor.staffId);
      assert.deepEqual(after.recipientExternal, before.recipientExternal);
    });

    it(`${channel}: explicit Create uses contact recipient without transfer before confirm`, async () => {
      const actor = await staffActor(channel);
      const item = `Contact create ${channel} ${actor.messengerId}`;
      let reply = await send(actor, { kind: "text", text: "Создать передачу" });
      reply = await send(actor, { kind: "text", text: item });
      reply = await send(actor, { kind: "callback", data: action(reply, /пропустить/iu) });
      reply = await send(actor, { kind: "callback", data: action(reply, /пропустить/iu) });
      const phone = `+7903${String(actor.messengerId).padStart(7, "0").slice(-7)}`;
      if (channel === "telegram") {
        reply = await send(actor, { kind: "tg_contact", phone, firstName: "Карта", lastName: "Получатель" });
      } else {
        reply = await send(actor, { kind: "max_unsigned_vcf", vcfRaw: unsignedMaxVcf("Карта Получатель", phone) });
      }
      reply = await send(actor, { kind: "callback", data: action(reply, /оставить/i) });
      reply = await send(actor, { kind: "callback", data: action(reply, /Далее/i) });
      reply = await send(actor, { kind: "callback", data: action(reply, /^Без срока$/u) });
      assert.match(reply.text, /Карта/u);
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE item_title=$1`, [item])).rows[0].n,
        0,
      );
      reply = await send(actor, { kind: "callback", data: action(reply, /^Создать передачу$/u) });
      assert.doesNotMatch(reply.text, /устар|не удалось|недоступ/i, `unexpected create reply: ${reply.text}`);
      const draftAfter = await getPool()!.query<{ confirmed_transfer_id: string | null }>(
        `SELECT confirmed_transfer_id::text FROM tt_external_request_drafts
         WHERE payload->>'staffUserId' = $1 AND confirmed_transfer_id IS NOT NULL LIMIT 1`,
        [actor.staffId],
      );
      assert.ok(draftAfter.rows[0]?.confirmed_transfer_id, `draft not confirmed; reply=${reply.text}`);
      const transfer = (
        await getPool()!.query(
          `SELECT p.display_name,p.phone_e164 FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id WHERE t.id=$1`,
          [draftAfter.rows[0]!.confirmed_transfer_id],
        )
      ).rows[0];
      assert.ok(transfer);
      assert.match(transfer.display_name, /Карта/);
      assert.equal(transfer.phone_e164, phone);
      assert.ok(reply.text.includes("http"), "invitation link returned after explicit create");
    });
  }

  it("telegram: foreign contact user_id does not create verification", async () => {
    const actor = await staffActor("telegram");
    await openExternalNameStep(actor);
    await send(actor, {
      kind: "tg_contact",
      phone: "+79034445566",
      firstName: "Foreign",
      contactUserId: 888999000,
    });
    assert.equal(
      (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_person_verifications WHERE messenger_user_id='888999000'`))
        .rows[0].n,
      0,
    );
  });

  it("max: distinct chat_id from user_id in dialog accepts staff unsigned card", async () => {
    const actor = await staffActor("max", 5000);
    assert.notEqual(actor.chatId, actor.messengerId);
    await openExternalPhoneStep(actor, "MAX Chat Offset");
    const phone = "+79035556677";
    await send(actor, { kind: "max_unsigned_vcf", vcfRaw: unsignedMaxVcf("VCF Name", phone) });
    const ext = (await draftPayload(actor.staffId)).recipientExternal as { name: string; phone: string };
    assert.equal(ext.name, "MAX Chat Offset");
    assert.equal(ext.phone, phone);
  });

  it("max: unsigned contact outside wizard does not show false acceptance (falls through)", async () => {
    const actor = await staffActor("max");
    const reply = await send(actor, {
      kind: "max_unsigned_vcf",
      vcfRaw: unsignedMaxVcf("Orphan", "+79036667788"),
    });
    assert.match(reply.text, /Выберите действие/u);
    assert.equal(
      (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_request_drafts WHERE payload->>'staffUserId'=$1`, [
        actor.staffId,
      ])).rows[0].n,
      0,
    );
  });

  it("max: signed own-contact inside eligible external step is recipient data only", async () => {
    const actor = await staffActor("max");
    const phone = "+79037778899";
    const { vcfRaw, hash } = signedMaxVcf(phone, actor.messengerId);
    await openExternalNameStep(actor);
    const before = await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_person_verifications`);
    const reply = await send(actor, {
      kind: "max_signed_contact",
      vcfRaw,
      hash,
      contactUserId: actor.messengerId,
    });
    const payload = await draftPayload(actor.staffId);
    assert.equal(payload.recipientExternal?.phone, phone);
    assert.match(String(payload.recipientExternal?.name ?? ""), /Own/i);
    assert.equal(before.rows[0].n, (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_external_person_verifications`)).rows[0].n);
    assert.ok(reply.buttons.some(b => /Оставить имя/u.test(b.text)), "native response must not be overwritten");
    assert.doesNotMatch(reply.text, /Код приёма|Код для передачи|одноразовый код/iu,
      "signed own card in wizard must not trigger verification code handoff");
  });

  it("both channels: multi-number card is rejected without mutating draft", async () => {
    for (const channel of ["telegram", "max"] as const) {
      const actor = await staffActor(channel);
      await openExternalNameStep(actor);
      const before = await draftPayload(actor.staffId);
      const vcf =
        "BEGIN:VCARD\r\nTEL:+79991111111\r\nTEL:+79992222222\r\nEND:VCARD";
      const reply =
        channel === "telegram"
          ? await send(actor, { kind: "tg_contact", phone: "+79991111111", vcard: vcf })
          : await send(actor, { kind: "max_unsigned_vcf", vcfRaw: vcf.replace(/\r\n/g, "\\r\\n") });
      assert.match(reply.text, /несколько|один/i);
      assert.deepEqual((await draftPayload(actor.staffId)).recipientExternal, before.recipientExternal);
    }
  });

  it("max: signed own-contact outside eligible draft is not treated as recipient card", async () => {
    const actor = await staffActor("max");
    const phone = "+79991112233";
    const { vcfRaw, hash } = signedMaxVcf(phone, actor.messengerId);
    const reply = await send(actor, {
      kind: "max_signed_contact",
      vcfRaw,
      hash,
      contactUserId: actor.messengerId,
    });
    assert.match(reply.text, /не принят|команды/i);
  });
});
