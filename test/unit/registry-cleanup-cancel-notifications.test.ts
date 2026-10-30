import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transferInternalIdFromExternalPersonOutboxKey } from "../../src/tan-tracker/registry-cleanup/cancel-transfer-notifications";

describe("transfer outbox idempotency parsing", () => {
  it("extracts internal transfer id from tt-ext-msg keys", () => {
    assert.equal(
      transferInternalIdFromExternalPersonOutboxKey("tt-ext-msg:delivered:tt-adm-001:hv:2"),
      "tt-adm-001",
    );
    assert.equal(
      transferInternalIdFromExternalPersonOutboxKey("tt-ext-msg:handoff_code:tt-adm-001:hv:1:telegram"),
      "tt-adm-001",
    );
    assert.equal(transferInternalIdFromExternalPersonOutboxKey("ext-web:draft-1"), null);
  });
});
