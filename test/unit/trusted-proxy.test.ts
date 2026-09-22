import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClientIp } from "../../src/http/trusted-proxy";

describe("trusted proxy client ip", () => {
  it("uses socket ip when trusted proxies are not configured", () => {
    const ip = resolveClientIp({
      socketRemoteAddress: "203.0.113.10",
      xForwardedFor: "198.51.100.5",
      trustedProxies: [],
    });
    assert.equal(ip, "203.0.113.10");
  });

  it("ignores spoofed X-Forwarded-For from untrusted socket", () => {
    const ip = resolveClientIp({
      socketRemoteAddress: "203.0.113.10",
      xForwardedFor: "198.51.100.5, 203.0.113.99",
      trustedProxies: ["127.0.0.1"],
    });
    assert.equal(ip, "203.0.113.10");
  });

  it("uses client ip from trusted proxy chain", () => {
    const ip = resolveClientIp({
      socketRemoteAddress: "127.0.0.1",
      xForwardedFor: "198.51.100.5, 127.0.0.1",
      trustedProxies: ["127.0.0.1"],
    });
    assert.equal(ip, "198.51.100.5");
  });
});
