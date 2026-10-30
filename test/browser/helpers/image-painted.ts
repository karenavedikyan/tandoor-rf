import assert from "node:assert/strict";
import type { Locator } from "playwright";

export type ImagePaintSample = {
  w: number;
  h: number;
  r: number;
  g: number;
  b: number;
  hidden: boolean;
};

/** Waits for decode + two animation frames, then samples center pixel (visual paint check). */
export async function sampleLocatorImagePaint(locator: Locator): Promise<ImagePaintSample> {
  return locator.evaluate(async (img: HTMLImageElement) => {
    if (!img.src) throw new Error("image has no src");
    await img.decode();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    const sx = Math.max(0, Math.floor(img.naturalWidth / 2));
    const sy = Math.max(0, Math.floor(img.naturalHeight / 2));
    ctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      r,
      g,
      b,
      hidden: img.hidden,
    };
  });
}

export function assertImageVisuallyPainted(sample: ImagePaintSample, label: string): void {
  assert.equal(sample.hidden, false, `${label}: lightbox image must be visible`);
  assert.ok(sample.w > 0 && sample.h > 0, `${label}: image must have natural dimensions`);
  assert.ok(
    !(sample.r >= 250 && sample.g >= 250 && sample.b >= 250),
    `${label}: center pixel must not be blank white (got rgb ${sample.r},${sample.g},${sample.b})`,
  );
}
