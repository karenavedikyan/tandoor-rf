import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultMaxTransport } from "../../src/tanbot-max/transport";
import type { MaxTransportCall } from "../../src/tanbot-max/types";

describe("tanbot max transport", () => {
  it("sends Authorization header without Bearer prefix", async () => {
    let authHeader = "";
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
      authHeader = String(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response(JSON.stringify({ user_id: 1, is_bot: true }), { status: 200 });
    };
    const transport = createDefaultMaxTransport(fetchImpl as typeof fetch);
    const result = await transport({
      method: "me",
      token: "test-token-abc",
      timeoutMs: 5000,
      maxResponseBytes: 65536,
    });
    assert.equal(result.ok, true);
    assert.equal(authHeader, "test-token-abc");
  });

  it("classifies 401 as UNAUTHORIZED", async () => {
    const fetchImpl = async () => new Response("{}", { status: 401 });
    const transport = createDefaultMaxTransport(fetchImpl as typeof fetch);
    const result = await transport({
      method: "me",
      token: null,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED");
  });

  it("allows null token for tls probe calls", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response("{}", { status: 401 });
    };
    const transport: MaxTransportCall = createDefaultMaxTransport(fetchImpl as typeof fetch);
    await transport({ method: "me", token: null, timeoutMs: 5000, maxResponseBytes: 65536 });
    assert.match(calls[0]!, /platform-api2\.max\.ru\/me$/);
  });
});
