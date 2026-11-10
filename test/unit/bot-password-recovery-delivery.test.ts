import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRecoveryDelivery } from "../../src/access/password-recovery-delivery";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";

let oldEnv: NodeJS.ProcessEnv;
describe("bot password recovery transports", { concurrency: false }, () => {
  beforeEach(() => {
    oldEnv = { ...process.env };
    Object.assign(process.env, {
      APP_ORIGIN: "http://127.0.0.1:3000",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "true",
      TANBOT_MAX_BOT_TOKEN: "synthetic-max-token-not-real",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-max-link-pepper-test",
      TANBOT_MAX_WEBHOOK_ENABLED: "false",
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:synthetic_telegram_token_test_only",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-telegram-link-pepper-test",
      TANBOT_TELEGRAM_WEBHOOK_ENABLED: "false",
    });
  });
  afterEach(() => { process.env = oldEnv; });
  it("sends MAX directly to the confirmed private user with bounded timeout", async () => {
    const calls: Parameters<MaxDeliveryTransport>[0][] = [];
    const send = createRecoveryDelivery({ max: async call => { calls.push(call); return { ok: true, result: {} }; } });
    assert.equal(await send({ channel: "max", userId: "1001", chatId: "2002", text: "Synthetic recovery text" }), true);
    assert.equal(calls[0]!.userId, 1001n); assert.equal(calls[0]!.text, "Synthetic recovery text");
    assert.ok(calls[0]!.timeoutMs <= 5000);
  });
  it("sends Telegram privately, protects content, with no parse mode or arbitrary chat", async () => {
    const calls: Parameters<TelegramDeliveryTransport>[0][] = [];
    const send = createRecoveryDelivery({ telegram: async call => { calls.push(call); return { ok: true, result: {} }; } });
    assert.equal(await send({ channel: "telegram", userId: "1001", chatId: "2002", text: "Synthetic recovery text" }), true);
    assert.equal(calls[0]!.method, "sendMessage"); assert.equal(calls[0]!.body.chat_id, "1001");
    assert.equal(calls[0]!.body.protect_content, true); assert.equal(calls[0]!.body.parse_mode, undefined);
    assert.ok(calls[0]!.timeoutMs <= 5000);
  });
  it("honors integration/delivery switches and safely handles provider rejection", async () => {
    let calls = 0;
    const send = createRecoveryDelivery({
      max: async () => { calls++; return { ok: false, code: "FORBIDDEN", message: "Synthetic failure" }; },
      telegram: async () => { calls++; return { ok: false, code: "FORBIDDEN", message: "Synthetic failure" }; },
    });
    for (const channel of ["max", "telegram"] as const) {
      const input = { channel, userId: "1001", chatId: "1001", text: "Synthetic" };
      assert.equal(await send(input), false);
      const prefix = channel === "max" ? "TANBOT_MAX" : "TANBOT_TELEGRAM";
      process.env[`${prefix}_DELIVERY_ENABLED`] = "false";
      const prior = calls;
      assert.equal(await send(input), false); assert.equal(calls, prior);
      process.env[`${prefix}_ENABLED`] = "false";
      assert.equal(await send(input), false); assert.equal(calls, prior);
    }
  });
});
