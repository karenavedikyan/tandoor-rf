import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acknowledgeMaxCatalogCallback } from "../../src/tanbot-max/webhook-handler";
import { createDefaultMaxDeliveryTransport, type MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import type { TanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";

const config = { deliveryEnabled: true, botToken: "synthetic-token", requestTimeoutMs: 10000,
  maxResponseBytes: 4096 } as TanbotMaxStage2Config;
const raw = (payload = "cat:root", chatType = "dialog", callbackId = "callback-id") => ({
  update_type: "message_callback", timestamp: 100,
  callback: { callback_id: callbackId, payload, user: { user_id: 123 } },
  message: { recipient: { chat_id: 456, chat_type: chatType } },
});
describe("MAX catalogue button acknowledgement", () => {
  it("preserves only a genuine bounded callback ID, never inventing one from timestamp", () => {
    const good = parseMaxWebhookUpdate(raw()); assert.ok(good.ok);
    assert.equal("callbackId" in good.update && good.update.callbackId, "callback-id");
    for (const id of ["", " ", "x".repeat(513)]) {
      const p = parseMaxWebhookUpdate(raw("cat:root", "dialog", id)); assert.ok(p.ok);
      assert.ok(!("callbackId" in p.update));
    }
  });
  it("starts immediately, has a short timeout and does not need catalogue/DB work to complete", async () => {
    let complete!: () => void;
    const calls: Parameters<MaxDeliveryTransport>[0][] = [];
    const transport: MaxDeliveryTransport = input => {
      calls.push(input);
      return new Promise(resolve => { complete = () => resolve({ ok: true, result: {} }); });
    };
    const pending = acknowledgeMaxCatalogCallback(config, transport, raw("cat2:0123456789abcdef:0"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].callbackId, "callback-id"); assert.equal(calls[0].text, "");
    assert.equal(calls[0].timeoutMs, 1200);
    assert.equal(calls[0].userId, 123n);
    complete(); await pending;
  });
  it("never acknowledges tracker callbacks, groups, malformed updates or disabled delivery", async () => {
    let calls = 0;
    const transport: MaxDeliveryTransport = async () => { calls++; return { ok: true, result: {} }; };
    for (const update of [raw("nc:tracker"), raw("cat:root", "chat"), raw("cat:root", "dialog", ""), {}]) {
      await acknowledgeMaxCatalogCallback(config, transport, update);
    }
    await acknowledgeMaxCatalogCallback({ ...config, deliveryEnabled: false }, transport, raw());
    await acknowledgeMaxCatalogCallback(config, null, raw());
    assert.equal(calls, 0);
    await acknowledgeMaxCatalogCallback(config, async () => { throw new Error("synthetic failure"); }, raw());
  });
  it("uses TLS-wrapped MAX API with an empty body, no new message, upload, token in URL or notification field", async () => {
    let calls = 0;
    const transport = createDefaultMaxDeliveryTransport(async (url, init) => {
      calls++;
      const u = new URL(String(url));
      assert.equal(u.pathname, "/answers");
      assert.equal(u.searchParams.get("callback_id"), "a/b&c");
      assert.ok(!u.searchParams.has("user_id")); assert.ok(!u.searchParams.has("access_token"));
      assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), {});
      assert.equal((init?.headers as Record<string, string>).Authorization, "synthetic-token");
      return Response.json({ success: true });
    }, {});
    const result = await transport({ token: "synthetic-token", userId: 123n, text: "",
      callbackId: "a/b&c", timeoutMs: 1000, maxResponseBytes: 4096, photoBytes: Buffer.from("not an upload") });
    assert.ok(result.ok); assert.equal(calls, 1);
    assert.equal((await transport({ token: "synthetic-token", userId: 123n, text: "",
      callbackId: " ", timeoutMs: 1000, maxResponseBytes: 4096 })).ok, false);
    assert.equal(calls, 1);
  });
});
