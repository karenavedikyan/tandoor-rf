import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandIpv4MappedAddress, isBlockedIpAddress } from "../../src/bitrix24/ip-security";

describe("bitrix24 ip security", () => {
  it("blocks unspecified and loopback IPv6", () => {
    assert.equal(isBlockedIpAddress("::"), true);
    assert.equal(isBlockedIpAddress("::1"), true);
  });

  it("blocks IPv4-mapped loopback forms", () => {
    assert.equal(isBlockedIpAddress("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedIpAddress("::ffff:7f00:1"), true);
    assert.equal(expandIpv4MappedAddress("::ffff:7f00:1"), "127.0.0.1");
  });

  it("allows public IPv4 and IPv6", () => {
    assert.equal(isBlockedIpAddress("93.184.216.34"), false);
    assert.equal(isBlockedIpAddress("2001:db8::1"), false);
  });

  it("blocks mixed private records when any address is private", () => {
    assert.equal(isBlockedIpAddress("192.168.1.10"), true);
    assert.equal(isBlockedIpAddress("10.0.0.5"), true);
  });
});
