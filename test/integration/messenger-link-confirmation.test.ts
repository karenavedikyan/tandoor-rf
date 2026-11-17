import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { startTanbotMaxLink } from "../../src/tanbot-max/link-service";
import { startTanbotLink } from "../../src/tanbot-telegram/link-service";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { handleExternalPersonMaxContact } from "../../src/tanbot/external-person/max-bot-flow";
import { handleExternalPersonTelegramContact } from "../../src/tanbot/external-person/telegram-bot-flow";

const databaseUrl = getIntegrationDatabaseUrl();
let serial = 100;
const maxConfig = () => { const c = loadTanbotMaxStage2Config(); assert.ok(c.ok); return c.config; };
const tgConfig = () => { const c = loadTanbotTelegramStage2Config(); assert.ok(c.ok); return c.config; };
function maxMessage(id: number, text: string, chatType = "dialog") {
  return { update_type: "message_created", timestamp: ++serial,
    message: { sender: { user_id: id, is_bot: false },
      recipient: { chat_id: id + 10000, chat_type: chatType }, body: { text, mid: `synthetic-${serial}` } } };
}
function maxStart(id: number, payload?: string) {
  return { update_type: "bot_started", timestamp: ++serial, chat_id: id + 10000,
    user: { user_id: id, is_bot: false }, ...(payload ? { payload } : {}) };
}
async function fixture() {
  const n = ++serial, phone = `+7900000${String(n).padStart(4, "0")}`;
  const additional = `+7910000${String(n).padStart(4, "0")}`;
  const user = await createTestUser({ databaseUrl, email: `confirmation-${n}@test.local`,
    password: "SyntheticPassword123!", fullName: "Синтетический сотрудник", phone });
  await getPool()!.query("UPDATE users SET additional_phone=$2 WHERE id=$1", [user.id, additional]);
  return { ...user, phone, additional, messenger: 700000 + n };
}
describe("phone-specific link confirmation and MAX deep-link recovery", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TT_EXTERNAL_MESSENGER_IN_USER_TEST = "true";
    for (const name of ["MAX", "TELEGRAM"]) {
      process.env[`TANBOT_${name}_ENABLED`] = "true";
      process.env[`TANBOT_${name}_BOT_TOKEN`] = name === "MAX"
        ? "SYNTH_MAX_TEST_TOKEN_0123456789abcdef" : "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
      process.env[`TANBOT_${name}_BOT_USERNAME`] = name === "MAX" ? "id231100522180_bot" : "TANDOOR_IBOT";
      process.env[`TANBOT_${name}_EXPECTED_USERNAME`] = process.env[`TANBOT_${name}_BOT_USERNAME`];
      process.env[`TANBOT_${name}_LINK_TOKEN_PEPPER`] = "synthetic-link-confirmation-pepper";
      process.env[`TANBOT_${name}_DELIVERY_ENABLED`] = "false";
    }
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
  });
  after(closePool);
  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: both accounts report their saved phone and opt-in, with deduplicated replies`, async () => {
      const user = await fixture();
      for (const [i, phone] of [user.phone, user.additional].entries()) {
        const enabled = i === 0, id = user.messenger + i;
        const link = channel === "max"
          ? await startTanbotMaxLink(getPool()!, maxConfig(), user.id, { phone, enableNotifications: enabled })
          : await startTanbotLink(getPool()!, tgConfig(), user.id, { phone, enableNotifications: enabled });
        const token = new URL(link.deepLink).searchParams.get("start")!;
        if (channel === "max" && i === 1) {
          await handleTanbotMaxUpdate(getPool()!, maxConfig(), maxStart(id));
          const pending = await getPool()!.query("SELECT consumed_at FROM tanbot_max_link_attempts WHERE id=$1", [link.attemptId]);
          assert.equal(pending.rows[0].consumed_at, null, "plain Start is not a successful LK link");
        }
        const raw = channel === "max" ? i === 0 ? maxStart(id, token) : maxMessage(id, `/start ${token}`)
          : { update_id: ++serial, message: { message_id: serial, chat: { id, type: "private" },
            from: { id, is_bot: false, first_name: "Synthetic" }, text: `/start ${token}` } };
        const handle = () => channel === "max"
          ? handleTanbotMaxUpdate(getPool()!, maxConfig(), raw)
          : handleTanbotTelegramUpdate(getPool()!, tgConfig(), raw);
        const result = await handle();
        assert.ok(result.reply);
        assert.ok(result.reply.text.includes(phone));
        assert.ok(!result.reply.text.includes(i === 0 ? user.additional : user.phone));
        assert.match(result.reply.text, enabled ? /успешно подключены и включены/ : /выключены/);
        assert.doesNotMatch(result.reply.text, /Номер подтверждён/);
        if (!enabled) assert.doesNotMatch(result.reply.text, /успешно подключены|включены/);
        assert.equal((await handle()).reply?.text, result.reply.text, "retry retains the confirmation");
        const rows = await getPool()!.query(`SELECT phone_e164,notifications_enabled,phone_confirmed_at
          FROM tanbot_${channel}_all_accounts WHERE user_id=$1 ORDER BY phone_e164`, [user.id]);
        assert.equal(rows.rowCount, i + 1);
        assert.equal(rows.rows.find(r => r.phone_e164 === phone).notifications_enabled, enabled);
        assert.equal(rows.rows.find(r => r.phone_e164 === phone).phone_confirmed_at, null);
      }
    });
    it(`${channel}: own-contact staff link also reports the stored phone and enabled notifications`, async () => {
      const user = await fixture(), id = BigInt(user.messenger);
      const client = await getPool()!.connect();
      try {
        await client.query("BEGIN");
        const common = { chatId: id, phoneRaw: user.phone, firstName: null,
          contactUserId: Number(id), isForwarded: false };
        const reply = channel === "max"
          ? await handleExternalPersonMaxContact(client, { ...common, maxUserId: id })
          : await handleExternalPersonTelegramContact(client, { ...common, telegramUserId: id });
        assert.ok(reply);
        assert.ok(reply.text.includes(user.phone));
        assert.match(reply.text, /успешно подключены и включены/);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
    });
  }
  for (const invalid of ["expired", "cancelled", "group", "conflict"] as const) {
    it(`MAX manual command keeps existing ${invalid} protection`, async () => {
      const user = await fixture();
      if (invalid === "conflict") {
        const other = await fixture();
        await getPool()!.query(`INSERT INTO tanbot_max_accounts
          (user_id,max_user_id,max_chat_id,phone_e164) VALUES ($1,$2,$2,$3)`,
        [other.id, user.messenger, other.phone]);
      }
      const link = await startTanbotMaxLink(getPool()!, maxConfig(), user.id, { phone: user.phone });
      if (invalid === "expired") await getPool()!.query(
        "UPDATE tanbot_max_link_attempts SET expires_at=NOW()-interval '1 second' WHERE id=$1", [link.attemptId]);
      if (invalid === "cancelled") await startTanbotMaxLink(getPool()!, maxConfig(), user.id, { phone: user.phone });
      const token = new URL(link.deepLink).searchParams.get("start")!;
      const result = await handleTanbotMaxUpdate(getPool()!, maxConfig(),
        maxMessage(user.messenger, `/start ${token}`, invalid === "group" ? "chat" : "dialog"));
      assert.doesNotMatch(result.reply?.text ?? "", /успешно подключены|MAX подключён к личному кабинету/);
      if (invalid === "expired" || invalid === "cancelled") assert.match(result.reply!.text, /недействительна или истекла/);
      if (invalid === "conflict") assert.match(result.reply!.text, /связан с другим аккаунтом/);
      const rows = await getPool()!.query("SELECT 1 FROM tanbot_max_all_accounts WHERE user_id=$1", [user.id]);
      assert.equal(rows.rowCount, 0);
    });
  }
  it("MAX system stop persists opt-out without a queued reply; explicit /stop still responds", async () => {
    const user = await fixture();
    await getPool()!.query(`INSERT INTO tanbot_max_accounts
      (user_id,max_user_id,max_chat_id,phone_e164) VALUES ($1,$2,$2,$3)`,
    [user.id, user.messenger, user.phone]);
    const raw = { update_type: "bot_stopped", timestamp: ++serial, chat_id: user.messenger + 10000,
      user: { user_id: user.messenger, is_bot: false } };
    const result = await handleTanbotMaxUpdate(getPool()!, maxConfig(), raw);
    assert.equal(result.reply, null);
    const saved = (await getPool()!.query("SELECT stopped_at,notifications_enabled FROM tanbot_max_accounts WHERE user_id=$1", [user.id])).rows[0];
    assert.ok(saved.stopped_at);
    assert.equal(saved.notifications_enabled, false);
    const inbox = (await getPool()!.query("SELECT status,reply_text,reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key=$1", [result.dedupKey])).rows[0];
    assert.equal(inbox.status, "committed");
    assert.equal(inbox.reply_text, null);
    assert.ok(inbox.reply_delivered_at);
    assert.equal((await handleTanbotMaxUpdate(getPool()!, maxConfig(), raw)).reply, null);
    await getPool()!.query("UPDATE tanbot_max_accounts SET stopped_at=NULL,notifications_enabled=TRUE WHERE user_id=$1", [user.id]);
    const explicit = await handleTanbotMaxUpdate(getPool()!, maxConfig(), maxMessage(user.messenger, "/stop"));
    assert.ok(explicit.reply);
    assert.match(explicit.reply.text, /отключены/);
  });
});
