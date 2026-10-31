import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxAttachmentsFromMessage } from "../../src/tanbot/external-person/max-attachment-parse";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";

describe("parseMaxAttachmentsFromMessage", () => {
  it("preserves mixed image and file order", () => {
    const parsed = parseMaxAttachmentsFromMessage({
      body: {
        attachments: [
          { type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=a" } },
          {
            type: "file",
            filename: "a.pdf",
            size: 1200,
            payload: { url: "https://iu.oneme.ru/getFile?token=b", token: "filetok" },
          },
        ],
      },
    });
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.kind, "image");
    assert.equal(parsed[1]?.kind, "file");
    assert.equal(parsed[1]?.fileName, "a.pdf");
    assert.equal(parsed[1]?.declaredSize, 1200);
  });

  it("reads root filename/size fallback on file attachment", () => {
    const parsed = parseMaxAttachmentsFromMessage({
      attachments: [
        {
          type: "file",
          file_name: "root.pdf",
          size: 500,
          payload: { token: "only-token" },
        },
      ],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.fileName, "root.pdf");
    assert.equal(parsed[0]?.ingestReject, "token_only");
  });
});

describe("parseMaxWebhookUpdate file messages", () => {
  it("accepts message_created with file attachment without caption text", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_created",
      timestamp: 42,
      message: {
        sender: { user_id: 5, is_bot: false },
        recipient: { chat_id: 11, chat_type: "dialog" },
        body: {
          mid: "mid-pdf-only",
          attachments: [
            {
              type: "file",
              filename: "doc.pdf",
              payload: { url: "https://iu.oneme.ru/getFile?token=pdf1" },
            },
          ],
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok && "normalizedAttachments" in parsed.update) {
      assert.equal(parsed.update.normalizedAttachments?.length, 1);
      assert.equal(parsed.update.commandText, null);
    }
  });
});
