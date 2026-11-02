import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";
import { parseMaxUnsignedRecipientVcfFromMessage, parseMaxContactFromMessage } from "../../src/tanbot/external-recipient/max-contact-verify";

const card = (payload: unknown, chatType = "dialog") => ({
  update_type: "message_created", timestamp: 1700000000000,
  message: {
    sender: { user_id: 321, is_bot: false }, recipient: { chat_id: 654, chat_type: chatType },
    body: { mid: "synthetic-contact-feedback", text: "", attachments: [{ type: "contact", payload }] },
  },
});

describe("MAX recipient card without VCF must not disappear as empty text", () => {
  for (const payload of [
    { max_info: { user_id: 123, first_name: "Synthetic contact" } },
    { max_info: { user_id: 123 }, vcf_info: null },
    { vcf_info: "" }, { vcf_info: 42 }, {}, null,
  ]) {
    it(`recognizes missing VCF ${JSON.stringify(payload)} as unverified data, not identity proof`, () => {
      const input = card(payload);
      const parsed = parseMaxWebhookUpdate(input);
      assert.ok(parsed.ok);
      if (!parsed.ok) return;
      assert.equal(parsed.update.unsignedVcfInfo, "");
      assert.equal(parsed.update.contact, undefined);
      assert.equal(parsed.update.chatId, 654n);
      assert.equal(parsed.update.maxUserId, 321n);
      assert.equal(parsed.update.isForwarded, false);
      assert.equal(parseMaxContactFromMessage(input.message), null);
    });
  }
  it("preserves actual VCF phone data and signed own-contact routing", () => {
    const vcf = "BEGIN:VCARD\nFN:Synthetic\nTEL:+79991112233\nEND:VCARD";
    const unsigned = parseMaxWebhookUpdate(card({ vcf_info: vcf, max_info: { user_id: 123 } }));
    assert.ok(unsigned.ok);
    if (unsigned.ok) assert.equal(unsigned.update.unsignedVcfInfo, vcf);
    const input = card({ vcf_info: vcf, hash: "a".repeat(64), max_info: { user_id: 123 } });
    assert.equal(parseMaxUnsignedRecipientVcfFromMessage(input.message), null);
    const signed = parseMaxWebhookUpdate(input);
    assert.ok(signed.ok);
    if (signed.ok) {
      assert.equal(signed.update.unsignedVcfInfo, undefined);
      assert.equal(signed.update.contact?.contactUserId, 123);
    }
  });
  it("does not create recipient data from group cards; forwarded flag stays untrusted", () => {
    const group = parseMaxWebhookUpdate(card({ max_info: { user_id: 123 } }, "chat"));
    if (group.ok) assert.equal(group.update.unsignedVcfInfo, undefined);
    const forwarded = card({ max_info: { user_id: 123 } });
    const parsed = parseMaxWebhookUpdate({ ...forwarded, message: { ...forwarded.message, link: { type: "forward" } } });
    assert.ok(parsed.ok);
    if (parsed.ok) assert.equal(parsed.update.isForwarded, true);
  });
});
