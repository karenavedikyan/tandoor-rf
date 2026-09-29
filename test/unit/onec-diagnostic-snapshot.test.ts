import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIdentitySnapshot } from "../../src/onec-diagnostics/snapshot";

const a = "0d714501-be78-11ee-812e-00155d0a0a4e";
const b = "f6901d52-fbfe-11eb-8103-00155d0a0a4e";
const row = { guid_client: a, guid_holding: b, guid_manager: b, name_manager: "Имя", address: "PRIVATE_ADDRESS", telephone: ["PRIVATE_PHONE"], name_client: "PRIVATE_CLIENT", Discount: 23 };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

test("snapshot includes only identity projection and field coverage, not client PII", () => {
  const r = buildIdentitySnapshot(encode([row]));
  assert.equal(r.records, 1);
  assert.equal(r.managers[0].guid, b);
  assert.equal(r.assignments[0].holdingGuid, b);
  assert.equal(r.fields.find(f => f.name === "Discount")?.nonempty, 1);
  for (const value of ["PRIVATE_ADDRESS", "PRIVATE_PHONE", "PRIVATE_CLIENT"]) {
    assert.equal(JSON.stringify(r).includes(value), false);
  }
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.sourceModifiedAt, null);
});
test("duplicates and malformed identities are flagged, not repaired or imported", () => {
  const r = buildIdentitySnapshot(encode([row, row, { guid_client: "bad", guid_manager: "bad" }, null]));
  assert.equal(r.duplicateClientGuids, 1);
  assert.equal(r.invalidRows, 1);
  assert.equal(r.invalidClientGuids, 1);
  assert.equal(r.invalidManagerGuids, 1);
});
test("same GUID with conflicting names is preserved for manual review", () => {
  const r = buildIdentitySnapshot(encode([row, { ...row, name_manager: "Другое имя" }]));
  assert.equal(r.managers.length, 1);
  assert.equal(r.managers[0].names.length, 2);
});
test("rejects invalid JSON, invalid UTF8, wrong root and oversized source", () => {
  for (const bytes of [Buffer.from("{"), Buffer.from([0xff]), encode({}), Buffer.alloc(10 * 1024 * 1024 + 1)]) {
    assert.throws(() => buildIdentitySnapshot(bytes));
  }
});
test("accepts UTF8 BOM and normalizes UUID case", () => {
  const r = buildIdentitySnapshot(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encode([{ ...row, guid_manager: b.toUpperCase() }])]));
  assert.equal(r.managers[0].guid, b);
});
