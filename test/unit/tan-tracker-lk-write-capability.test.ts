import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("tan-tracker LK write capability UI wiring", () => {
  const trackerJs = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");
  const lkApi = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker-lk-api.js"), "utf8");
  const attJs = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker-attachments.js"), "utf8");

  it("hydrateFromServer applies server capabilities.canWrite", () => {
    const hydrate = trackerJs.slice(trackerJs.indexOf("function hydrateFromServer"));
    assert.match(hydrate, /applyLkCapabilitiesFromBootstrap\(data\)/);
    assert.match(trackerJs, /data\.capabilities\?\.canWrite === true/);
  });

  it("blocks cabinet mutation actions when lkCanWrite is false", () => {
    assert.match(trackerJs, /CABINET_WRITE_ACTIONS/);
    assert.match(trackerJs, /denyCabinetWriteMutation/);
    assert.match(trackerJs, /showCreateEntryPoints/);
    assert.match(trackerJs, /data-tt="lk-readonly-banner"/);
  });

  it("create submit uses pending flag against double POST", () => {
    assert.match(trackerJs, /state\.createSubmitting = true/);
    assert.match(trackerJs, /data-tt="create-pending"/);
  });

  it("staging upload parses non-JSON error responses", () => {
    assert.match(lkApi, /response\.text\(\)/);
    assert.match(lkApi, /JSON\.parse/);
  });

  it("client staging infers HEIC/HEIF mime from filename", () => {
    assert.match(attJs, /image\/heic/);
    assert.match(attJs, /heic/i);
    assert.ok(attJs.includes('mime = "image/heic"'));
  });
});
