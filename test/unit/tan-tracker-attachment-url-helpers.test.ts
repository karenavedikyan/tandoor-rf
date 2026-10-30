import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

function loadTanTrackerAttachments() {
  const src = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker-attachments.js"), "utf8");
  const context: { window: Record<string, unknown> } = { window: {} };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.window.TanTrackerAttachments as {
    attachmentThumbUrl: (url: string) => string;
    attachmentLightboxUrl: (url: string) => string;
    attachmentDownloadUrl: (url: string) => string;
  };
}

describe("tan-tracker attachment URL helpers", () => {
  const Att = loadTanTrackerAttachments();
  const blobUrl = "blob:http://127.0.0.1:3000/6f2c8b1a-9e3d-4c1a-b2a0-111111111111";
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const apiUrl = "/api/tan-tracker/transfers/TT-1/attachments/00000000-0000-4000-8000-000000000001";

  it("leaves blob and data URLs unchanged for preview and download helpers", () => {
    assert.equal(Att.attachmentThumbUrl(blobUrl), blobUrl);
    assert.equal(Att.attachmentLightboxUrl(blobUrl), blobUrl);
    assert.equal(Att.attachmentDownloadUrl(blobUrl), blobUrl);
    assert.equal(Att.attachmentThumbUrl(dataUrl), dataUrl);
    assert.equal(Att.attachmentLightboxUrl(dataUrl), dataUrl);
    assert.equal(Att.attachmentDownloadUrl(dataUrl), dataUrl);
  });

  it("adds explicit preview/download query params for server attachment URLs", () => {
    assert.match(Att.attachmentThumbUrl(apiUrl), /[?&]preview=thumb(?:&|$)/);
    assert.match(Att.attachmentLightboxUrl(apiUrl), /[?&]preview=lightbox(?:&|$)/);
    assert.match(Att.attachmentDownloadUrl(apiUrl), /[?&]download=1(?:&|$)/);
  });
});
