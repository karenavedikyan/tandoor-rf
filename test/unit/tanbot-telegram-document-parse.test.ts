import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTelegramWebhookUpdate } from "../../src/tanbot-telegram/update-parse";

describe("parseTelegramWebhookUpdate document", () => {
  it("parses private document before empty text rejection", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 1,
      message: {
        message_id: 9,
        date: 1,
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false },
        document: {
          file_id: "doc-file-id",
          file_name: "invoice.pdf",
          mime_type: "application/pdf",
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.parsed.kind, "document");
      assert.equal(parsed.parsed.update.fileId, "doc-file-id");
      assert.equal(parsed.parsed.update.fileName, "invoice.pdf");
    }
  });

  it("still prefers photo array over document when both present", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 2,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: 101, type: "private" },
        from: { id: 101, is_bot: false },
        photo: [{ file_id: "p1", file_unique_id: "u1", width: 1, height: 1 }],
        document: { file_id: "d1", file_name: "x.pdf" },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.parsed.kind, "photo");
  });
});
