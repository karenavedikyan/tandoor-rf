import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchMaxNativeAttachmentBytes, fetchTelegramNativeAttachmentBytes } from "../../src/tanbot/native-create/native-attachment-fetch";
import { fetchBoundedBinary } from "../../src/tanbot-telegram/bounded-binary-fetch";

describe("Computer native attachment download boundaries", { concurrency: false }, () => {
  let realFetch: typeof fetch;
  let previousEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    previousEnv = { ...process.env };
    Object.assign(process.env, {
      APP_ORIGIN: "http://127.0.0.1:3000",
      TANBOT_TELEGRAM_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_ATTACHMENT_FETCH_ONLY",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-native-attachment-pepper",
      TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_attachment_bot",
      TANBOT_TELEGRAM_WEBHOOK_ENABLED: "false",
      TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TT_MAX_MEDIA_HOST_SUFFIXES: ".oneme.ru,.okcdn.ru",
    });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = previousEnv;
    mock.timers.reset();
  });

  it("generic HTML, executable and playlist documents stay opaque exact bytes", async () => {
    for (const bytes of [
      Buffer.from("<html>Document, not a rendered web page</html>"),
      Buffer.from("MZ-opaque-test-fixture"),
      Buffer.from("#EXTM3U\nhttps://untrusted.invalid/not-followed\n"),
    ]) {
      let calls = 0;
      globalThis.fetch = async (_, options) => {
        calls++; assert.equal(options?.redirect, "error");
        return new Response(bytes);
      };
      const result = await fetchMaxNativeAttachmentBytes("https://synthetic.oneme.ru/file", "file");
      assert.ok(result.ok);
      assert.equal(result.mimeType, "application/octet-stream");
      assert.deepEqual(result.buffer, bytes);
      assert.equal(calls, 1, "opaque documents are never parsed or followed");
    }
  });

  it("native video rejects HLS, HTML, XML and JSON metadata instead of falsely saving a clip", async () => {
    for (const text of [
      "#EXTM3U\nhttps://untrusted.invalid/segment\n",
      "<html>Provider error</html>",
      "<!DOCTYPE html><html>Error</html>",
      "<?xml version=\"1.0\"?><MPD/>",
      "<MPD>stream manifest</MPD>",
      "{\"url\":\"https://untrusted.invalid/video\"}",
      "[{\"error\":\"temporary\"}]",
    ]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(text); };
      const result = await fetchMaxNativeAttachmentBytes("https://synthetic.oneme.ru/clip", "video");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /видео как файл/iu);
      assert.equal(calls, 1, "metadata never triggers a secondary URL fetch");
    }
  });

  it("native image failures do not turn HTML or arbitrary files into successful photos", async () => {
    for (const value of ["<html>Provider error</html>", "%PDF-1.7\n%%EOF", "MZ-fixture"]) {
      globalThis.fetch = async () => new Response(value);
      const result = await fetchMaxNativeAttachmentBytes("https://synthetic.oneme.ru/photo", "image");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /как файл/iu);
    }
  });

  it("existing global image fetch remains strictly image-only", async () => {
    globalThis.fetch = async () => new Response("<html>Opaque document</html>");
    const result = await fetchBoundedBinary("https://synthetic.oneme.ru/image", 1024);
    assert.deepEqual(result, { ok: false, code: "NOT_IMAGE" });
  });

  it("Telegram rejects absolute, encoded, traversal, query and malformed metadata paths before download", async () => {
    for (const filePath of [
      "/absolute.pdf", "../escape.pdf", "documents/../escape.pdf", "documents/./file.pdf",
      "https://untrusted.invalid/file.pdf", "documents/%2e%2e/escape.pdf",
      "documents/%252e%252e/escape.pdf", "documents\\escape.pdf",
      "documents/file.pdf?query=1", "documents/file.pdf#fragment", "documents/\nfile.pdf",
      "documents//file.pdf", 42, {}, null,
    ]) {
      let calls = 0;
      globalThis.fetch = async (input, options) => {
        calls++;
        assert.equal(calls, 1, "unsafe metadata cannot start a binary download");
        assert.equal(new URL(String(input)).hostname, "api.telegram.org");
        assert.equal(options?.redirect, "error");
        return new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }));
      };
      const result = await fetchTelegramNativeAttachmentBytes("synthetic");
      assert.equal(result.ok, false);
      assert.equal(calls, 1);
    }
  });

  it("Telegram metadata byte limit rejects before a binary request", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("x".repeat(32_769)); };
    const result = await fetchTelegramNativeAttachmentBytes("synthetic");
    assert.equal(result.ok, false); assert.equal(calls, 1);
  });

  it("Telegram metadata deadline stays active until the response body finishes", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0, aborted = false;
    globalThis.fetch = async (_, options) => {
      calls++;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from("{\"ok\":"));
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            controller.error(new DOMException("Synthetic body timeout", "AbortError"));
          }, { once: true });
        },
      }));
    };
    const pending = fetchTelegramNativeAttachmentBytes("synthetic");
    await Promise.resolve();
    await Promise.resolve();
    mock.timers.tick(15_001);
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(aborted, true); assert.equal(calls, 1);
  });

  it("actual binary byte limit wins over a misleading successful response", async () => {
    globalThis.fetch = async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1));
    const result = await fetchMaxNativeAttachmentBytes("https://synthetic.oneme.ru/file", "file");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /8\s*МБ/iu);
  });
});
