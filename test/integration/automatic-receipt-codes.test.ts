import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import type { PoolClient } from "pg";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { getPool, resetPoolForTests, closePool } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  enqueueAutomaticReceiptCode,
  processAutomaticReceiptCodes,
  handleAutomaticReceiptCallback,
  automaticReceiptCallback,
  requestAutomaticReceiptCodeByHolder,
  type AutomaticReceiptTransport,
} from "../../src/tan-tracker/automatic-receipt-codes";
import { buildMaxNativeCreateContext, buildTelegramNativeCreateContext } from "../../src/tanbot/native-create/adapters";
import { handleNativeCreateCallback, handleNativeCreateMessage, type NativeCreateReply } from "../../src/tanbot/native-create/engine";
import { buildReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";
import { generateHandoffCodeForPendingParty } from "../../src/tan-tracker/handoff-code-generate";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import { requireHandoffOtpPepper } from "../../src/tan-tracker/otp-config";
import { verifyPendingReceiptCode } from "../../src/tan-tracker/verify-pending-receipt-code";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import request from "supertest";
import { createApp } from "../../src/server";
import { signHolderAccess } from "../../src/tan-tracker/holder-access";

type Channel = "telegram" | "max";
type Actor = {
  party: string;
  user: string;
  chat: string;
  person?: string;
  staff?: string;
  phone: string;
  channel: Channel;
};
const db = getIntegrationDatabaseUrl();
let sequence = 650000;
const p = () => getPool()!;
async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await p().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function actor(channel: Channel, staff = false): Promise<Actor> {
  const n = ++sequence,
    user = String(n),
    chat = String(channel === "max" ? n + 200000 : n),
    phone = `+7912${String(n).padStart(7, "0")}`;
  if (staff) {
    const u = await createTestUser({
      databaseUrl: db,
      email: `auto-${n}@test.local`,
      password: "SyntheticPass123!",
      fullName: "Synthetic staff",
      role: "admin",
      phone,
    });
    const party = await ensurePartyForUserOnWrite(
      p(),
      u.id,
      "Synthetic staff",
      phone,
    );
    await p().query(
      `INSERT INTO tanbot_${channel}_accounts(user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`,
      [u.id, user, chat],
    );
    return { party: party.id, user, chat, staff: u.id, phone, channel };
  }
  const party = (
    await p().query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Synthetic receiver',$1) RETURNING id`,
      [phone],
    )
  ).rows[0].id;
  const person = randomUUID();
  await p().query(
    "INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,'Synthetic receiver',$3)",
    [person, party, phone],
  );
  await p().query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`,
    [person, channel, user, chat],
  );
  return { party, person, user, chat, phone, channel };
}
async function transfer(to: Actor, fromStaff = true) {
  const from = await actor(to.channel, fromStaff),
    id = `TT-AUTO-${++sequence}`;
  await p().query(
    `INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id,final_recipient_party_id,handoff_version)
    VALUES($1,$1,'Synthetic parcel','waiting',$2,$2,$3,$3,1)`,
    [id, from.party, to.party],
  );
  await p().query(
    `INSERT INTO tt_transfer_invitations(transfer_id,handoff_version,holder_party_id,pending_party_id,item_snapshot)
    VALUES($1,1,$2,$3,'Synthetic parcel')`,
    [id, from.party, to.party],
  );
  return { id, from };
}
const jobs = async (id: string) =>
  (
    await p().query(
      "SELECT * FROM tt_automatic_receipt_codes WHERE transfer_id=$1 ORDER BY handoff_version",
      [id],
    )
  ).rows;
async function queued(to: Actor, fromStaff = true) {
  const t = await transfer(to, fromStaff);
  assert.equal(
    await tx((c) => enqueueAutomaticReceiptCode(c, t.id, to.channel)),
    true,
  );
  return { ...t, job: (await jobs(t.id))[0] };
}
async function expire(id: string) {
  await p().query(
    "UPDATE tt_handoff_codes SET expires_at=NOW()-interval '1 second' WHERE transfer_id=$1",
    [id],
  );
  await p().query(
    "UPDATE tt_automatic_receipt_codes SET code_expires_at=NOW()-interval '1 second' WHERE transfer_id=$1",
    [id],
  );
}
async function callback(a: Actor, id: string) {
  return tx((c) =>
    handleAutomaticReceiptCallback(c, {
      channel: a.channel,
      userId: BigInt(a.user),
      chatId: BigInt(a.chat),
      payload: automaticReceiptCallback(id),
    }),
  );
}
async function native(a: Actor, text = "", data?: string): Promise<NativeCreateReply> {
  return tx(async c => {
    const ctx = a.channel === "max"
      ? await buildMaxNativeCreateContext(c, { chatId: BigInt(a.chat), maxUserId: BigInt(a.user), recipientChatType: "dialog" })
      : await buildTelegramNativeCreateContext(c, { chatId: BigInt(a.chat), telegramUserId: BigInt(a.user), privateDialogOk: true });
    const reply = data ? await handleNativeCreateCallback(c, ctx, data) : await handleNativeCreateMessage(c, ctx, text);
    assert.ok(reply);
    return reply;
  });
}
function nativeButtons(reply: NativeCreateReply) {
  return (reply.telegramInlineKeyboard ?? reply.maxInlineButtons ?? []).flat() as Array<{
    text: string; callback_data?: string; payload?: string;
  }>;
}
function nativeButton(reply: NativeCreateReply, text: string): string {
  const b = nativeButtons(reply).find(b => b.text === text);
  assert.ok(b, JSON.stringify(reply));
  return b.callback_data ?? b.payload!;
}
const collect =
  (
    messages: Parameters<AutomaticReceiptTransport>[0][],
  ): AutomaticReceiptTransport =>
  async (m) => {
    messages.push(m);
    return { ok: true };
  };

before(async () => {
  setIntegrationEnv(db);
  Object.assign(process.env, {
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TT_USER_TEST_ENV: "true",
    TT_EXTERNAL_MESSENGER_IN_USER_TEST: "true",
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456:synthetic-automatic-token-123456789",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-webhook-secret",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-link-pepper",
    TANBOT_MAX_ENABLED: "true",
    TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "true",
    TANBOT_MAX_BOT_TOKEN: "synthetic-max-token",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-webhook-secret",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-link-pepper",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
});
after(closePool);
beforeEach(async () => {
  await p().query(
    "UPDATE tt_automatic_receipt_codes SET status='cancelled',encrypted_code=NULL WHERE status='pending'",
  );
});
describe(
  "automatic receipt delivery to verified recipients",
  { concurrency: false },
  () => {
    for (const channel of ["telegram", "max"] as const) {
      for (const staff of [false, true]) {
        it(`${channel}/${staff ? "staff" : "external"}: one queued stage, context then digits, no holder leak or replay`, async () => {
          const a = await actor(channel, staff),
            t = await queued(a),
            out: Parameters<AutomaticReceiptTransport>[0][] = [];
          await tx((c) => enqueueAutomaticReceiptCode(c, t.id, channel));
          assert.equal((await jobs(t.id)).length, 1);
          const transport = collect(out);
          assert.equal(
            (
              await processAutomaticReceiptCodes(p(), {
                channel,
                transport,
                deliveryEnabled: true,
              })
            ).sent,
            1,
          );
          assert.equal(out.length, 2);
          assert.match(out[0].text, /Synthetic parcel/);
          assert.equal(out[0].callback, automaticReceiptCallback(t.job.id));
          assert.match(out[1].text, /^\d{6}$/);
          assert.ok(
            out.every((m) => m.userId === a.user && m.chatId === a.chat),
          );
          assert.equal(out[1].callback, undefined);
          const j = (await jobs(t.id))[0];
          assert.equal(j.status, "sent");
          assert.equal(j.encrypted_code, null);
          assert.equal(
            j.code_hash,
            hashOtp(out[1].text, requireHandoffOtpPepper()),
          );
          assert.equal(
            (
              await p().query(
                "SELECT * FROM tt_handoff_codes WHERE transfer_id=$1",
                [t.id],
              )
            ).rowCount,
            1,
          );
          assert.equal(
            (
              await p().query(
                "SELECT holder_party_id FROM tt_transfers WHERE id=$1",
                [t.id],
              )
            ).rows[0].holder_party_id,
            t.from.party,
          );
          assert.equal(
            (
              await p().query(
                "SELECT * FROM tanbot_notification_outbox WHERE payload->>'transferId'=$1",
                [t.id],
              )
            ).rowCount,
            0,
          );
          await processAutomaticReceiptCodes(p(), {
            channel,
            transport,
            deliveryEnabled: true,
          });
          assert.equal(out.length, 2);
          const result = await tx(async (c) => {
            const row = (
              await c.query(
                "SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE",
                [t.id],
              )
            ).rows[0];
            return verifyPendingReceiptCode(c, {
              row,
              code: out[1].text,
              auditUserId: null,
              actingPartyId: t.from.party,
              botReply: true,
            });
          });
          assert.equal(result.ok, true);
          const after = (
            await p().query("SELECT * FROM tt_transfers WHERE id=$1", [t.id])
          ).rows[0];
          assert.equal(after.holder_party_id, a.party);
          assert.equal(after.pending_party_id, null);
          const second = await tx((c) =>
            verifyPendingReceiptCode(c, {
              row: after,
              code: out[1].text,
              auditUserId: null,
              actingPartyId: t.from.party,
              botReply: true,
            }),
          );
          assert.equal(second.ok, false);
        });
      }
      it(`${channel}: retry after context retains same code and sends no duplicate context`, async () => {
        const a = await actor(channel),
          t = await queued(a),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        let fail = true;
        const transport: AutomaticReceiptTransport = async (m) => {
          out.push(m);
          if (!m.callback && fail) {
            fail = false;
            throw new Error("synthetic delivery failure");
          }
          return { ok: true };
        };
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport,
          deliveryEnabled: true,
        });
        const row = (await jobs(t.id))[0];
        assert.ok(row.header_sent_at);
        assert.ok(row.encrypted_code);
        assert.notEqual(row.encrypted_code, out[1].text);
        await p().query(
          "UPDATE tt_automatic_receipt_codes SET next_attempt_at=NOW() WHERE id=$1",
          [row.id],
        );
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport,
          deliveryEnabled: true,
        });
        assert.equal(out.length, 3);
        assert.equal(out[1].text, out[2].text);
        assert.equal(
          (
            await p().query(
              "SELECT COUNT(*)::int AS n FROM tt_handoff_codes WHERE transfer_id=$1",
              [t.id],
            )
          ).rows[0].n,
          1,
        );
      });
      it(`${channel}: recipient refresh is private, deduped while queued and bounded`, async () => {
        const a = await actor(channel),
          foreign = await actor(channel),
          t = await queued(a),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        const transport = collect(out);
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport,
          deliveryEnabled: true,
        });
        assert.match((await callback(foreign, t.job.id)).text, /недоступна/);
        assert.match((await callback(a, t.job.id)).text, /ещё действует/);
        await expire(t.id);
        assert.match((await callback(a, t.job.id)).text, /Запрошен новый/);
        assert.match((await callback(a, t.job.id)).text, /уже поставлен/);
        assert.equal((await jobs(t.id))[0].generation, 2);
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport,
          deliveryEnabled: true,
        });
        assert.equal(out.length, 4);
        await expire(t.id);
        await callback(a, t.job.id);
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport,
          deliveryEnabled: true,
        });
        await expire(t.id);
        assert.match((await callback(a, t.job.id)).text, /Лимит/);
        assert.equal((await jobs(t.id))[0].generation, 3);
        assert.equal(
          (
            await p().query(
              "SELECT COUNT(*)::int AS n FROM tt_transfers WHERE id=$1",
              [t.id],
            )
          ).rows[0].n,
          1,
        );
      });
      it(`${channel}: actual webhook routes refresh and retry does not increment generation twice`, async () => {
        const a = await actor(channel),
          t = await queued(a);
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect([]),
          deliveryEnabled: true,
        });
        await expire(t.id);
        const event = ++sequence,
          payload = automaticReceiptCallback(t.job.id);
        const invoke = async () => {
          if (channel === "telegram") {
            const cfg = loadTanbotTelegramStage2Config();
            assert.ok(cfg.ok);
            return handleTanbotTelegramUpdate(p(), cfg.config, {
              update_id: event,
              callback_query: {
                id: String(event),
                from: { id: Number(a.user), is_bot: false },
                data: payload,
                message: {
                  message_id: event,
                  chat: { id: Number(a.chat), type: "private" },
                },
              },
            });
          }
          const cfg = loadTanbotMaxStage2Config();
          assert.ok(cfg.ok);
          return handleTanbotMaxUpdate(p(), cfg.config, {
            update_type: "message_callback",
            timestamp: event,
            callback: {
              callback_id: String(event),
              user: { user_id: Number(a.user), is_bot: false },
              payload,
            },
            message: {
              sender: { user_id: 1, is_bot: true },
              recipient: { chat_id: Number(a.chat), chat_type: "dialog" },
              body: { mid: String(event), text: "Synthetic" },
            },
          });
        };
        await invoke();
        await invoke();
        assert.equal((await jobs(t.id))[0].generation, 2);
      });
      for (const mutation of [
        "optout",
        "rebind",
        "phone",
        "stage",
        "archive",
        "delete",
      ] as const) {
        it(`${channel}: ${mutation} cancels queued delivery without generating or disclosing a code`, async () => {
          const a = await actor(channel),
            t = await queued(a),
            out: Parameters<AutomaticReceiptTransport>[0][] = [];
          if (mutation === "optout")
            await p().query(
              "UPDATE tt_external_person_verifications SET notifications_enabled=FALSE,opted_out_at=NOW() WHERE person_id=$1",
              [a.person],
            );
          if (mutation === "rebind")
            await p().query(
              "UPDATE tt_external_person_verifications SET messenger_user_id=$2,messenger_chat_id=$2 WHERE person_id=$1",
              [a.person, String(++sequence)],
            );
          if (mutation === "phone")
            await p().query(
              "UPDATE tt_parties SET phone_e164='+79000000000' WHERE id=$1",
              [a.party],
            );
          if (mutation === "stage")
            await p().query(
              "UPDATE tt_transfers SET handoff_version=2 WHERE id=$1",
              [t.id],
            );
          if (mutation === "archive")
            await p().query(
              "UPDATE tt_transfers SET general_archived_at=NOW() WHERE id=$1",
              [t.id],
            );
          if (mutation === "delete")
            await p().query("DELETE FROM tt_transfers WHERE id=$1", [t.id]);
          await processAutomaticReceiptCodes(p(), {
            channel,
            transport: collect(out),
            deliveryEnabled: true,
          });
          assert.equal(out.length, 0);
          assert.equal(
            (
              await p().query(
                "SELECT * FROM tt_handoff_codes WHERE transfer_id=$1",
                [t.id],
              )
            ).rowCount,
            0,
          );
        });
      }
      it(`${channel}: no verification, opt-out and disabled transport do not create/send auto code`, async () => {
        const a = await actor(channel),
          t = await transfer(a);
        await p().query(
          "UPDATE tt_external_person_verifications SET opted_out_at=NOW() WHERE person_id=$1",
          [a.person],
        );
        assert.equal(
          await tx((c) => enqueueAutomaticReceiptCode(c, t.id, channel)),
          false,
        );
        const b = await actor(channel),
          queuedJob = await queued(b),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(out),
          deliveryEnabled: false,
        });
        assert.equal(out.length, 0);
        assert.equal((await jobs(queuedJob.id))[0].encrypted_code, null);
        await p().query(
          "DELETE FROM tt_external_person_verifications WHERE person_id=$1",
          [b.person],
        );
        assert.equal(
          await tx((c) =>
            enqueueAutomaticReceiptCode(c, queuedJob.id, channel),
          ),
          false,
        );
      });
      it(`${channel}: parallel workers and expired/replaced OTP never generate a second retry code`, async () => {
        const a = await actor(channel),
          t = await queued(a),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        await Promise.all(
          [1, 2].map(() =>
            processAutomaticReceiptCodes(p(), {
              channel,
              transport: collect(out),
              deliveryEnabled: true,
            }),
          ),
        );
        assert.equal(out.length, 2);
        const other = await queued(await actor(channel)),
          partial: Parameters<AutomaticReceiptTransport>[0][] = [];
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: async (m) => {
            partial.push(m);
            return m.callback
              ? { ok: true }
              : { ok: false, code: "RATE_LIMIT", retryable: true };
          },
          deliveryEnabled: true,
        });
        await tx((c) =>
          generateHandoffCodeForPendingParty(c, {
            transferIdOrCode: other.id,
            pendingPartyId: other.job.pending_party_id,
            auditPartyId: other.job.pending_party_id,
            auditUserId: null,
            notifyHolder: false,
          }),
        );
        await p().query(
          "UPDATE tt_automatic_receipt_codes SET next_attempt_at=NOW() WHERE id=$1",
          [other.job.id],
        );
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(partial),
          deliveryEnabled: true,
        });
        assert.equal(partial.length, 2);
        assert.equal((await jobs(other.id))[0].status, "cancelled");
      });
      it(`${channel}: expired, exhausted and old queued codes are not delivered`, async () => {
        for (const kind of ["expired", "attempts", "backlog"]) {
          const a = await actor(channel),
            t = await queued(a),
            out: Parameters<AutomaticReceiptTransport>[0][] = [];
          if (kind !== "backlog")
            await processAutomaticReceiptCodes(p(), {
              channel,
              deliveryEnabled: true,
              transport: async (m) =>
                m.callback
                  ? { ok: true }
                  : { ok: false, code: "RETRY", retryable: true },
            });
          if (kind === "expired") await expire(t.id);
          if (kind === "attempts")
            await p().query(
              "UPDATE tt_handoff_codes SET verify_attempt_count=5 WHERE transfer_id=$1",
              [t.id],
            );
          await p().query(
            "UPDATE tt_automatic_receipt_codes SET next_attempt_at=NOW()-($2::int*interval '1 minute') WHERE id=$1",
            [t.job.id, kind === "backlog" ? 31 : 1],
          );
          await processAutomaticReceiptCodes(p(), {
            channel,
            transport: collect(out),
            deliveryEnabled: true,
          });
          assert.equal(out.length, 0);
          assert.equal((await jobs(t.id))[0].status, "cancelled");
        }
      });
      it(`${channel}: stopped staff never receive an auto code`, async () => {
        const a = await actor(channel, true),
          t = await queued(a),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        await p().query(
          `UPDATE tanbot_${channel}_accounts SET stopped_at=NOW() WHERE user_id=$1`,
          [a.staff],
        );
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(out),
          deliveryEnabled: true,
        });
        assert.equal(out.length, 0);
        assert.equal((await jobs(t.id))[0].status, "cancelled");
      });
      for (const holderStaff of [true, false]) for (const recipientStaff of [true, false]) {
        it(`${channel}: native continuation ${holderStaff ? "staff" : "external"} to original ${recipientStaff ? "staff" : "external"} sender reuses creation delivery, history and canonical OTP`, async () => {
          const a = await actor(channel, holderStaff), t = await queued(a, recipientStaff);
          // Staff can select only their eligible external contacts; do not widen the production catalog.
          if (holderStaff && !recipientStaff) {
            await p().query("UPDATE tt_parties SET created_by_user_id=$2 WHERE id=$1", [t.from.party, a.staff]);
          }
          const initial: Parameters<AutomaticReceiptTransport>[0][] = [];
          await processAutomaticReceiptCodes(p(), { channel, transport: collect(initial), deliveryEnabled: true });
          assert.equal(initial.length, 2);
          await tx(async c => {
            const row = (await c.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [t.id])).rows[0];
            assert.equal((await verifyPendingReceiptCode(c, {
              row, code: initial[1].text, auditUserId: t.from.staff ?? null, actingPartyId: t.from.party, botReply: true,
            })).ok, true);
          });
          const received = (await p().query("SELECT * FROM tt_transfers WHERE id=$1", [t.id])).rows[0];
          assert.equal(received.holder_party_id, a.party);
          const existingHistory = (await p().query("SELECT id FROM tt_transfer_timeline WHERE transfer_id=$1", [t.id])).rows;
          const parties = Number((await p().query("SELECT COUNT(*) FROM tt_parties")).rows[0].count);
          let reply = await native(a, "", buildReceiptEntryCallback("forward", t.id, received.handoff_version)!);
          assert.match(reply.text, /Передать дальше/);
          reply = await native(a, t.from.phone);
          for (let step = 0; step < 6 && !nativeButtons(reply).some(b => b.text === "Передать дальше"); step++) {
            const next = nativeButtons(reply).find(b => /^(Далее|Подтвердить имя|Synthetic staff|Synthetic receiver)/.test(b.text));
            reply = next ? await native(a, "", next.callback_data ?? next.payload)
              : await native(a, recipientStaff ? "Synthetic staff" : "Synthetic receiver");
          }
          assert.match(reply.text, /Продолжится этот же трек/);
          assert.doesNotMatch(reply.text, /затем перешлите приглашение/);
          const confirmed = await native(a, "", nativeButton(reply, "Передать дальше"));
          assert.match(confirmed.text, /Код будет отправлен получателю в подключённый бот/);
          assert.match(confirmed.text, /Пересылать приглашение не нужно/);
          assert.doesNotMatch(confirmed.text, /Передача создана/);
          assert.equal(confirmed.forwardInvitationText, undefined);
          const pending = (await p().query("SELECT * FROM tt_transfers WHERE id=$1", [t.id])).rows[0];
          assert.equal(pending.holder_party_id, a.party);
          assert.equal(pending.pending_party_id, t.from.party);
          for (const key of ["id", "public_code", "item_title", "final_recipient_party_id", "comment"]) {
            assert.equal(pending[key], received[key]);
          }
          assert.equal(pending.due_at?.getTime(), received.due_at?.getTime());
          assert.equal(Number((await p().query("SELECT COUNT(*) FROM tt_parties")).rows[0].count), parties);
          assert.equal(Number((await p().query("SELECT COUNT(*) FROM tt_transfers WHERE id=$1", [t.id])).rows[0].count), 1);
          const laterHistory = new Set((await p().query("SELECT id FROM tt_transfer_timeline WHERE transfer_id=$1", [t.id])).rows.map(r => r.id));
          for (const h of existingHistory) assert.ok(laterHistory.has(h.id));
          const out: Parameters<AutomaticReceiptTransport>[0][] = [];
          await processAutomaticReceiptCodes(p(), { channel, transport: collect(out), deliveryEnabled: true });
          assert.equal(out.length, 2);
          assert.ok(out.every(m => m.userId === t.from.user && m.channel === channel));
          assert.doesNotMatch(confirmed.text, new RegExp(out[1].text));
          const entry = await native(a, "", nativeButton(confirmed, "Ввести код"));
          const currentJob = (await jobs(t.id)).find(j => j.handoff_version === pending.handoff_version)!;
          const cooldown = await native(a, "", nativeButton(entry, "Запросить код повторно"));
          assert.match(cooldown.text, /через минуту/);
          assert.equal((await jobs(t.id)).find(j => j.id === currentJob.id)!.generation, currentJob.generation);
          await expire(t.id);
          const retry = await native(a, "", nativeButton(entry, "Запросить код повторно"));
          assert.match(retry.text, /повторная отправка кода получателю в подключённый бот/);
          assert.equal(retry.forwardInvitationText, undefined);
          const renewed: Parameters<AutomaticReceiptTransport>[0][] = [];
          await processAutomaticReceiptCodes(p(), { channel, transport: collect(renewed), deliveryEnabled: true });
          assert.equal(renewed.length, 2);
          assert.ok(renewed.every(m => m.userId === t.from.user));
          assert.doesNotMatch(retry.text, new RegExp(renewed[1].text));
          assert.equal((await p().query("SELECT holder_party_id FROM tt_transfers WHERE id=$1", [t.id])).rows[0].holder_party_id, a.party);
          const receipt = await native(a, renewed[1].text);
          assert.match(receipt.text, /Получение подтверждено/);
          const after = (await p().query("SELECT * FROM tt_transfers WHERE id=$1", [t.id])).rows[0];
          assert.equal(after.holder_party_id, t.from.party);
          assert.equal(after.pending_party_id, null);
          assert.notEqual(after.status, "completed");
        });
      }
      it(`${channel}: holder resend rejects foreign, stale, closed and general-archived requests without changing jobs`, async () => {
        const a = await actor(channel), t = await queued(a);
        const before = await jobs(t.id);
        for (const input of [
          { holderPartyId: a.party, handoffVersion: 1 },
          { holderPartyId: t.from.party, handoffVersion: 0 },
        ]) {
          assert.equal(await tx(c => requestAutomaticReceiptCodeByHolder(c, { transferId: t.id, channel, ...input })), "unavailable");
        }
        for (const sql of ["status='completed',completed_at=NOW()", "status='obsolete'", "general_archived_at=NOW()", "deleted_at=NOW()"]) {
          await tx(async c => {
            await c.query("SAVEPOINT guarded_case");
            await c.query(`UPDATE tt_transfers SET ${sql} WHERE id=$1`, [t.id]);
            assert.equal(await requestAutomaticReceiptCodeByHolder(c, { transferId: t.id, channel, holderPartyId: t.from.party, handoffVersion: 1 }), "unavailable");
            await c.query("ROLLBACK TO SAVEPOINT guarded_case");
          });
        }
        assert.deepEqual(await jobs(t.id), before);
      });
      it(`${channel}: continuing the same track enqueues only the new stage and invalidates old refresh`, async () => {
        const a = await actor(channel),
          b = await actor(channel),
          t = await queued(a),
          out: Parameters<AutomaticReceiptTransport>[0][] = [];
        await p().query(
          "UPDATE tt_transfers SET final_recipient_party_id=$2 WHERE id=$1",
          [t.id, b.party],
        );
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(out),
          deliveryEnabled: true,
        });
        await tx(async (c) => {
          const row = (
            await c.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [
              t.id,
            ])
          ).rows[0];
          const result = await verifyPendingReceiptCode(c, {
            row,
            code: out[1].text,
            auditUserId: null,
            actingPartyId: t.from.party,
            botReply: true,
          });
          assert.equal(result.ok, true);
        });
        assert.match((await callback(a, t.job.id)).text, /устарел/);
        const token = signHolderAccess({
          transferId: t.id,
          partyId: a.party,
          hv: 2,
          exp: Date.now() + 60_000,
        });
        const response = await request(createApp())
          .post("/api/tan-tracker/public/holder/send-to-final")
          .set("Origin", process.env.APP_ORIGIN!)
        .send({holderAccessToken:token})
          .expect(200);
      assert.equal(response.body.orders[0].id, t.id);
      assert.equal(response.body.orders[0].automaticReceiptStatus,"pending");
        const stages = await jobs(t.id);
        assert.equal(stages.length, 2);
        assert.equal(stages[1].handoff_version, 3);
        assert.equal(stages[1].pending_party_id, b.party);
        const next: Parameters<AutomaticReceiptTransport>[0][] = [];
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(next),
          deliveryEnabled: true,
        });
        assert.equal(next.length, 2);
        assert.ok(next.every((m) => m.userId === b.user));
        assert.equal(
          (
            await p().query(
              "SELECT COUNT(*)::int AS n FROM tt_transfers WHERE id=$1",
              [t.id],
            )
          ).rows[0].n,
          1,
        );
      });
    }
    it("two verified channels still produce only one selected recipient message pair", async () => {
      const a = await actor("telegram"),
        t = await transfer(a);
      await p().query(
        `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
      VALUES($1,'max',$2,$2)`,
        [a.person, String(++sequence)],
      );
      assert.equal(
        await tx((c) => enqueueAutomaticReceiptCode(c, t.id, "telegram")),
        true,
      );
      const out: Parameters<AutomaticReceiptTransport>[0][] = [];
      for (const channel of ["telegram", "max"] as const)
        await processAutomaticReceiptCodes(p(), {
          channel,
          transport: collect(out),
          deliveryEnabled: true,
        });
      assert.equal(out.length, 2);
      assert.ok(
        out.every((m) => m.channel === "telegram" && m.userId === a.user),
      );
    });
  },
);
