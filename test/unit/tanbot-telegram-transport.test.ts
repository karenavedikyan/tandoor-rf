import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultTelegramTransport } from "../../src/tanbot-telegram/transport";

const TOKEN = "123456789:SYNTH_TRANSPORT_TEST_TOKEN_abcdefghijklmnopqrst";

describe("tanbot telegram transport", () => {
  it("rejects oversize responses", async () => {
    const transport = createDefaultTelegramTransport(async () =>
      Response.json({ ok: true, result: { id: 1, is_bot: true } }),
    );
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 8,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RESPONSE_TOO_LARGE");
  });

  it("parses ok:false Telegram envelope as API error", async () => {
    const transport = createDefaultTelegramTransport(async () =>
      Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }),
    );
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED");
  });

  it("handles invalid JSON safely", async () => {
    const transport = createDefaultTelegramTransport(async () => new Response("not-json"));
    const result = await transport({
      method: "getWebhookInfo",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_JSON");
  });
});
