import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isIpInTrustedList, resolveClientIp } from "../../src/http/trusted-proxy";

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

  it("matches IPv4 addresses against IPv4 CIDR entries", () => {
    assert.equal(isIpInTrustedList("10.1.2.3", ["10.0.0.0/8"]), true);
    assert.equal(isIpInTrustedList("203.0.113.10", ["10.0.0.0/8"]), false);
  });

  it("does not match IPv6 addresses against IPv4 CIDR entries", () => {
    assert.equal(isIpInTrustedList("2001:db8::a00:1", ["10.0.0.0/8"]), false);
  });

  it("matches IPv6 addresses against IPv6 CIDR entries", () => {
    assert.equal(isIpInTrustedList("2001:db8::a00:1", ["2001:db8::/32"]), true);
    assert.equal(isIpInTrustedList("2001:db9::1", ["2001:db8::/32"]), false);
  });

  it("matches IPv4-mapped IPv6 socket addresses against IPv4 trusted entries", () => {
    assert.equal(isIpInTrustedList("::ffff:10.1.2.3", ["10.0.0.0/8"]), true);
    assert.equal(isIpInTrustedList("::ffff:203.0.113.10", ["10.0.0.0/8"]), false);
  });

  it("walks X-Forwarded-For from right to left through trusted proxies", () => {
    const ip = resolveClientIp({
      socketRemoteAddress: "10.0.0.5",
      xForwardedFor: "198.51.100.5, 10.0.0.2, 10.0.0.3",
      trustedProxies: ["10.0.0.0/8"],
    });
    assert.equal(ip, "198.51.100.5");
  });

  it("returns socket ip when every forwarded hop is trusted", () => {
    const ip = resolveClientIp({
      socketRemoteAddress: "10.0.0.5",
      xForwardedFor: "10.0.0.2, 10.0.0.3",
      trustedProxies: ["10.0.0.0/8"],
    });
    assert.equal(ip, "10.0.0.2");
  });
});
