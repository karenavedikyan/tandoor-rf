import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import {
  decodeVcfInfoForHmac,
  extractPhoneFromVcf,
  parseMaxContactFromMessage,
  verifyMaxContactVcfHash,
} from "../../src/tanbot/external-recipient/max-contact-verify";

const BOT_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";

describe("max native contact verify", () => {
  it("reads hash from payload.hash and requires max_info.user_id", () => {
    const vcfRaw =
      "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Test\\r\\nTEL;TYPE=CELL:+79991112233\\r\\nEND:VCARD";
    const decoded = decodeVcfInfoForHmac(vcfRaw);
    const hash = crypto.createHmac("sha256", BOT_TOKEN).update(decoded, "utf8").digest("hex");
    const parsed = parseMaxContactFromMessage({
      body: {
        attachments: [
          {
            type: "contact",
            payload: {
              vcf_info: vcfRaw,
              max_info: { user_id: 9001001, first_name: "Test" },
              hash,
            },
          },
        ],
      },
    });
    assert.ok(parsed);
    assert.equal(parsed!.contactUserId, 9001001);
    assert.equal(parsed!.contactHash, hash);
    assert.equal(extractPhoneFromVcf(vcfRaw), "79991112233");
    assert.equal(verifyMaxContactVcfHash(BOT_TOKEN, vcfRaw, hash), true);
  });

  it("rejects payload when hash is only under max_info", () => {
    const parsed = parseMaxContactFromMessage({
      body: {
        attachments: [
          {
            type: "contact",
            payload: {
              vcf_info: "BEGIN:VCARD\\r\\nEND:VCARD",
              max_info: { user_id: 1, hash: "deadbeef" },
            },
          },
        ],
      },
    });
    assert.equal(parsed, null);
  });

  it("rejects when max_info.user_id missing", () => {
    const parsed = parseMaxContactFromMessage({
      body: {
        attachments: [
          {
            type: "contact",
            payload: { vcf_info: "BEGIN:VCARD\\r\\nEND:VCARD", hash: "aa".repeat(32) },
          },
        ],
      },
    });
    assert.equal(parsed, null);
  });
});
