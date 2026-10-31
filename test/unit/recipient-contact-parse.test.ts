import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRecipientContactFromTelegram,
  parseRecipientContactFromVcf,
} from "../../src/tanbot/native-create/recipient-contact-parse";

describe("recipient contact parse (unverified card)", () => {
  it("parses folded VCF TEL and FN", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Иван Петров",
      "N:Петров;Иван;;;",
      "TEL;TYPE=CELL:+7 (999) 123-45-67",
      "END:VCARD",
    ].join("\r\n");
    const r = parseRecipientContactFromVcf(vcf);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.phonesE164[0], "+79991234567");
      assert.match(r.data.suggestedName ?? "", /Иван/);
    }
  });

  it("deduplicates multiple representations of the same number", () => {
    const vcf = [
      "BEGIN:VCARD",
      "TEL:+79991234567",
      "TEL;TYPE=CELL:89991234567",
      "END:VCARD",
    ].join("\n");
    const r = parseRecipientContactFromVcf(vcf);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data.phonesE164.length, 1);
  });

  it("reports two distinct numbers for multi-TEL vcard", () => {
    const vcf = [
      "BEGIN:VCARD",
      "TEL:+79031111111",
      "TEL:+79032222222",
      "END:VCARD",
    ].join("\n");
    const r = parseRecipientContactFromVcf(vcf);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data.phonesE164.length, 2);
  });

  it("telegram contact uses first+last as suggested name", () => {
    const r = parseRecipientContactFromTelegram({
      phoneRaw: "+79995556677",
      firstName: "Мария",
      lastName: "Клиент",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.phonesE164[0], "+79995556677");
      assert.match(r.data.suggestedName ?? "", /Мария/);
    }
  });
  it("telegram does not fall back to primary phone when supplied vcard exceeds bounds", () => {
    const r = parseRecipientContactFromTelegram({ phoneRaw: "+79995556677", vcard: "X".repeat(16385) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "TOO_LARGE");
  });
  it("telegram rejects oversized primary phone without normalizing away its excessive whitespace", () => {
    const r = parseRecipientContactFromTelegram({ phoneRaw: "+79995556677" + " ".repeat(1000) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "TOO_LARGE");
  });
  it("telegram reports ambiguity instead of silently choosing a vcard phone different from the visible primary", () => {
    const r = parseRecipientContactFromTelegram({ phoneRaw: "+79995556677",
      vcard: "BEGIN:VCARD\nFN:Contact\nTEL:+79991112233\nEND:VCARD" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.data.phonesE164, ["+79995556677", "+79991112233"]);
  });
});
