import assert from "node:assert/strict";
import { it } from "node:test";
import {
  encryptAutomaticReceiptCode,
  decryptAutomaticReceiptCode,
} from "../../src/tan-tracker/automatic-receipt-crypto";
import {
  isAutomaticReceiptCallback,
  automaticReceiptCallback,
  automaticReceiptSenderGuidance,
} from "../../src/tan-tracker/automatic-receipt-codes";

it("receipt OTP ciphertext is randomized, authenticated and bound to exact recipient/generation", () => {
  const code = "438105",
    ctx = "synthetic-recipient-context-1";
  const a = encryptAutomaticReceiptCode(code, ctx),
    b = encryptAutomaticReceiptCode(code, ctx);
  assert.notEqual(a, b);
  assert.notEqual(a, code);
  assert.equal(decryptAutomaticReceiptCode(a, ctx), code);
  assert.throws(() => decryptAutomaticReceiptCode(a, `${ctx}:other-recipient`));
  const bits = a.split(".");
  bits[2] = Buffer.from("999999").toString("base64url");
  assert.throws(() => decryptAutomaticReceiptCode(bits.join("."), ctx));
  for (const text of ["", "bad", "a.b.c", `${a}.extra`])
    assert.throws(() => decryptAutomaticReceiptCode(text, ctx));
  assert.throws(() => encryptAutomaticReceiptCode("123", ctx));
});
it("receipt callback contains only a job id, and sender copy makes no delivery claim or code disclosure", () => {
  const cb = automaticReceiptCallback("50000000-0000-4000-8000-000000000001");
  assert.equal(isAutomaticReceiptCallback(cb), true);
  assert.ok(Buffer.byteLength(cb) <= 64);
  for (const text of [
    "ac:123456",
    "ac:",
    "ac:50000000-0000-4000-8000-000000000001:extra",
  ])
    assert.equal(isAutomaticReceiptCallback(text), false);
  const text = automaticReceiptSenderGuidance("TT-SYNTHETIC");
  assert.match(text, /Код будет отправлен/);
  assert.doesNotMatch(text, /Код отправлен|уже доставлен|438105|Перешлите/);
});
