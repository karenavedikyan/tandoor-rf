import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseMaxImageFromMessage,
  parseMaxImagesFromMessage,
} from "../../src/tanbot/external-person/max-image-parse";

describe("parseMaxImageFromMessage", () => {
  it("parses official image attachment url on body.attachments", () => {
    const parsed = parseMaxImageFromMessage({
      body: {
        attachments: [
          {
            type: "image",
            payload: { url: "https://iu.oneme.ru/getImage?token=abc", photo_id: 1 },
          },
        ],
      },
    });
    assert.ok(parsed);
    assert.match(parsed!.downloadUrl, /oneme\.ru/);
  });

  it("ignores non-allowlisted url", () => {
    const parsed = parseMaxImageFromMessage({
      body: {
        attachments: [{ type: "image", payload: { url: "https://evil.example/x.jpg" } }],
      },
    });
    assert.equal(parsed, null);
  });

  it("collects every image attachment in an album", () => {
    const parsed = parseMaxImagesFromMessage({
      body: {
        attachments: [
          { type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=a" } },
          { type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=b" } },
        ],
      },
    });
    assert.equal(parsed.length, 2);
  });

  it("returns token-only payload without url", () => {
    const parsed = parseMaxImageFromMessage({
      body: { attachments: [{ type: "image", payload: { token: "mediafile_token_xyz" } }] },
    });
    assert.ok(parsed);
    assert.equal(parsed!.downloadUrl, "");
    assert.equal(parsed!.mediaToken, "mediafile_token_xyz");
  });

  it("album keeps rejected unsafe slots for partial ingest feedback", () => {
    const parsed = parseMaxImagesFromMessage({
      body: {
        attachments: [
          { type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=a" } },
          { type: "image", payload: { url: "https://127.0.0.1/x.jpg" } },
        ],
      },
    });
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1]?.ingestReject, "unsafe_url");
  });
});
