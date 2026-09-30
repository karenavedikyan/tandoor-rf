import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandIpv4MappedAddress, isBlockedIpAddress } from "../../src/bitrix24/ip-security";

describe("bitrix24 ip security", () => {
  const blocked = [
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:0:0:0",
    "0:0:0:0:0:ffff:7f00:1",
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    "fe90::1",
    "fe80::1",
    "224.0.0.1",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ];

  const allowed = [
    "93.184.216.34",
    "8.8.8.8",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2606:4700:4700::1111",
  ];

  for (const address of blocked) {
    it(`blocks ${address}`, () => {
      assert.equal(isBlockedIpAddress(address), true);
    });
  }

  for (const address of allowed) {
    it(`allows ${address}`, () => {
      assert.equal(isBlockedIpAddress(address), false);
    });
  }

  it("treats equivalent IPv6 forms consistently", () => {
    const forms = [
      "0:0:0:0:0:ffff:7f00:1",
      "0000:0000:0000:0000:0000:FFFF:7F00:0001",
      "::ffff:127.0.0.1",
    ];
    for (const form of forms) {
      assert.equal(isBlockedIpAddress(form), true, form);
      assert.equal(expandIpv4MappedAddress(form), "127.0.0.1", form);
    }
  });
});
