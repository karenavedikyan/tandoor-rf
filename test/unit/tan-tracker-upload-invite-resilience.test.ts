import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("tan-tracker upload + messenger invite resilience wiring", () => {
  const lkApi = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker-lk-api.js"), "utf8");
  const attJs = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker-attachments.js"), "utf8");
  const trackerJs = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");

  it("uses operation-specific staging upload timeout with hard deadline without changing global default", () => {
    assert.match(lkApi, /STAGING_UPLOAD_TIMEOUT_MS = 120000/);
    assert.match(lkApi, /linkedAbortSignal\(STAGING_UPLOAD_TIMEOUT_MS/);
    assert.match(lkApi, /ttHardTimeout: true/);
    assert.doesNotMatch(lkApi, /REQUEST_TIMEOUT_MS =/);
    assert.match(lkApi, /Можно выбрать файл ещё раз/);
  });

  it("extends messenger invite via timeoutMs, hard race, and maps abort-like errors to Russian", () => {
    assert.match(lkApi, /MESSENGER_INVITE_TIMEOUT_MS = 45000/);
    assert.match(lkApi, /timeoutMs: MESSENGER_INVITE_TIMEOUT_MS/);
    assert.match(lkApi, /Promise\.race\(\[inviteRequest, inviteHardTimeout\]\)/);
    assert.match(lkApi, /mapRequestError\(err, inviteTimeoutSec\)/);
  });

  it("bounds raster decode with a probe deadline", () => {
    assert.match(attJs, /rasterProbeTimeoutMs = 20000/);
    assert.match(attJs, /finish\("timeout"\)/);
    assert.match(attJs, /превышено время проверки изображения/i);
  });

  it("aborts in-flight upload on attach context bump and re-validates snap after await", () => {
    assert.match(trackerJs, /attachInFlightAbort = new AbortController\(\)/);
    assert.match(trackerJs, /uploadStagingFile\(file, \{ signal: uploadSignal \}\)/);
    assert.match(trackerJs, /if \(state\.attachBusy\) abortAttachInFlight\(\)/);
    assert.match(trackerJs, /if \(!attachSnapValid\(snap\)\) \{\s*Att\(\)\.revokeStagingItem\(r\.item\);\s*break;/);
  });
});
