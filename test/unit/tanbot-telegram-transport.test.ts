import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBoundedResponseBody } from "../../src/tanbot-telegram/bounded-body";
import { createDefaultTelegramTransport } from "../../src/tanbot-telegram/transport";
import type { TelegramTransportCall } from "../../src/tanbot-telegram/types";

const TOKEN = "123456789:SYNTH_TRANSPORT_TEST_TOKEN_abcdefghijklmnopqrst";

describe("tanbot telegram transport", () => {
  it("rejects oversize streamed responses early (TB-BOUND-02)", async () => {
    let pullCount = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(4096));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { status: 200 });
    const result = await readBoundedResponseBody(response, 4096);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RESPONSE_TOO_LARGE");
    assert.ok(pullCount >= 2);
    assert.equal(cancelled, true);
  });

  it("accepts body exactly at limit", async () => {
    const body = new Uint8Array(4096);
    const response = new Response(body, { status: 200 });
    const result = await readBoundedResponseBody(response, 4096);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.bytesRead, 4096);
  });

  it("blocks disallowed methods with zero fetch calls (TB-BOUND-03)", async () => {
    let fetchCalls = 0;
    const transport = createDefaultTelegramTransport(async () => {
      fetchCalls += 1;
      return Response.json({ ok: true, result: {} });
    });
    const result = await (transport as TelegramTransportCall)({
      method: "deleteWebhook" as "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "METHOD_NOT_ALLOWED");
    assert.equal(fetchCalls, 0);
  });

  it("does not follow redirects (TB-BOUND-03)", async () => {
    let secondOriginCalled = false;
    const transport = createDefaultTelegramTransport(async (input) => {
      if (String(input).includes("9082")) {
        secondOriginCalled = true;
      }
      return Response.redirect("http://127.0.0.1:9082/hook", 302);
    });
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    assert.equal(secondOriginCalled, false);
  });

  it("classifies HTTP 403 HTML as FORBIDDEN (TB-ERR-05)", async () => {
    const transport = createDefaultTelegramTransport(async () =>
      new Response("<html>forbidden</html>", { status: 403, headers: { "Content-Type": "text/html" } }),
    );
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  it("classifies HTTP 429 HTML as RATE_LIMITED (TB-ERR-05)", async () => {
    const transport = createDefaultTelegramTransport(async () =>
      new Response("<html>slow down</html>", { status: 429 }),
    );
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RATE_LIMITED");
      assert.equal(result.retryable, true);
    }
  });

  it("marks HTTP 503 JSON as retryable API_ERROR (TB-ERR-05)", async () => {
    const transport = createDefaultTelegramTransport(async () =>
      Response.json({ ok: false, error_code: 503, description: "server" }, { status: 503 }),
    );
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "API_ERROR");
      assert.equal(result.retryable, true);
    }
  });

  it("handles invalid JSON on success status", async () => {
    const transport = createDefaultTelegramTransport(async () => new Response("not-json", { status: 200 }));
    const result = await transport({
      method: "getMe",
      token: TOKEN,
      timeoutMs: 5_000,
      maxResponseBytes: 65_536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_JSON");
  });
});
