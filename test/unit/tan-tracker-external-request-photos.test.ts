import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { before, describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

type PhotosApi = {
  validatePhotoFile: (file: { type: string; size: number } | null) => { ok: boolean; message?: string };
  countSuccessfulPhotos: (photos: Array<{ status: string }>) => number;
  hasPendingUploads: (photos: Array<{ status: string }>) => boolean;
  photoStepNextLabel: (photos: Array<{ status: string }>) => string;
  commentStepNextLabel: (comment: string) => string;
  canAddMorePhotos: (photos: Array<{ status: string }>) => boolean;
  MAX_PHOTOS: number;
  MAX_BYTES: number;
};

describe("TtExtRequestPhotos helpers", () => {
  let api: PhotosApi;

  before(() => {
    const script = readFileSync(join(root, "public/tan-tracker-external-request-photos.js"), "utf8");
    const sandbox = { window: {} as { TtExtRequestPhotos?: PhotosApi } };
    vm.runInNewContext(script, sandbox);
    api = sandbox.window.TtExtRequestPhotos!;
    assert.ok(api, "TtExtRequestPhotos must load");
  });

  it("rejects oversize and unsupported types", () => {
    assert.equal(api.validatePhotoFile(null).ok, false);
    assert.equal(api.validatePhotoFile({ type: "application/pdf", size: 100 }).ok, false);
    assert.equal(api.validatePhotoFile({ type: "image/png", size: api.MAX_BYTES + 1 }).ok, false);
    assert.equal(api.validatePhotoFile({ type: "image/png", size: 100 }).ok, true);
  });

  it("counts success and pending for labels and limits", () => {
    const photos = [
      { status: "success" },
      { status: "uploading" },
      { status: "error" },
      { status: "success" },
    ];
    assert.equal(api.countSuccessfulPhotos(photos), 2);
    assert.equal(api.hasPendingUploads(photos), true);
    assert.equal(api.photoStepNextLabel(photos), "Далее");
    assert.equal(api.photoStepNextLabel([]), "Пропустить");
    assert.equal(api.commentStepNextLabel("  hi "), "Далее");
    assert.equal(api.commentStepNextLabel("   "), "Пропустить");
    const full = Array.from({ length: api.MAX_PHOTOS }, () => ({ status: "success" }));
    assert.equal(api.canAddMorePhotos(full), false);
  });
});
