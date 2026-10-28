/** Browser-side contrast helpers as a string for page.evaluate (avoids tsx __name injection). */
export const PREVIEW_BANNER_CONTRAST_ENGINE = String.raw`
  const blend = (fg, alpha, bg) => Math.round(fg * alpha + bg * (1 - alpha));
  const cssColorToRgba = (cssColor) => {
    const trimmed = String(cssColor || "").trim();
    if (!trimmed) return [0, 0, 0, 0];
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("rgb")) {
      const inner = lower.slice(lower.indexOf("(") + 1, lower.lastIndexOf(")"));
      const nums = inner.split(",").map((part) => parseFloat(part.trim()));
      if (nums.length >= 3 && nums.slice(0, 3).every((n) => Number.isFinite(n))) {
        const alpha = nums.length >= 4 && Number.isFinite(nums[3]) ? nums[3] : 1;
        return [nums[0], nums[1], nums[2], alpha];
      }
    }
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return [0, 0, 0, 1];
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = trimmed;
    const hex = ctx.fillStyle;
    if (typeof hex === "string" && hex.startsWith("#")) {
      const expanded =
        hex.length === 4
          ? "#" + hex.slice(1).split("").map((c) => c + c).join("")
          : hex;
      const n = parseInt(expanded.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    return [0, 0, 0, 1];
  };
  const lum = (rgb) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrastRatio = (fgRgb, bgRgb) => {
    const a = lum(fgRgb);
    const b = lum(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const compositeBg = (el) => {
    if (!el) return [255, 255, 255];
    const style = getComputedStyle(el);
    const [r, g, b, a] = cssColorToRgba(style.backgroundColor);
    const opacity = Number(style.opacity);
    const effectiveA = a * (Number.isFinite(opacity) ? opacity : 1);
    const parent = compositeBg(el.parentElement);
    if (effectiveA <= 0.001) return parent;
    if (effectiveA >= 0.999) return [r, g, b];
    return [
      blend(r, effectiveA, parent[0]),
      blend(g, effectiveA, parent[1]),
      blend(b, effectiveA, parent[2]),
    ];
  };
  const effectiveFgRgb = (el, baseBgRgb) => {
    const style = getComputedStyle(el);
    const [r, g, b, a] = cssColorToRgba(style.color);
    const opacity = Number(style.opacity);
    const effectiveA = a * (Number.isFinite(opacity) ? opacity : 1);
    const bg = baseBgRgb;
    return [
      blend(r, effectiveA, bg[0]),
      blend(g, effectiveA, bg[1]),
      blend(b, effectiveA, bg[2]),
    ];
  };
  const isTransparentBackground = (style) => {
    const raw = style.getPropertyValue("background-color").trim();
    if (!raw || raw === "transparent") return true;
    const rgba = cssColorToRgba(raw);
    return rgba[3] <= 0.001;
  };
  const buttonSurfaceRgb = (el, backdropEl) => {
    const backdropRgb = compositeBg(backdropEl);
    const style = getComputedStyle(el);
    if (isTransparentBackground(style)) return backdropRgb;
    const [r, g, b, a] = cssColorToRgba(style.backgroundColor);
    const opacity = Number(style.opacity);
    const effectiveA = a * (Number.isFinite(opacity) ? opacity : 1);
    if (effectiveA <= 0.001) return backdropRgb;
    return [
      blend(r, effectiveA, backdropRgb[0]),
      blend(g, effectiveA, backdropRgb[1]),
      blend(b, effectiveA, backdropRgb[2]),
    ];
  };
  const measureContrast = (textSelector, backdropSelector) => {
    const textEl = document.querySelector(textSelector);
    const backdropEl = document.querySelector(backdropSelector);
    if (!textEl || !backdropEl) {
      throw new Error("Missing element for " + textSelector + " / " + backdropSelector);
    }
    const bgRgb = compositeBg(backdropEl);
    const fgRgb = effectiveFgRgb(textEl, bgRgb);
    return { fgRgb, bgRgb, ratio: contrastRatio(fgRgb, bgRgb) };
  };
  const measureButtonContrast = (selector, backdropSelector) => {
    const el = document.querySelector(selector);
    const backdropEl = document.querySelector(backdropSelector);
    if (!el || !backdropEl) {
      throw new Error("Missing button or backdrop for " + selector);
    }
    const bgRgb = buttonSurfaceRgb(el, backdropEl);
    const fgRgb = effectiveFgRgb(el, bgRgb);
    return { fgRgb, bgRgb, ratio: contrastRatio(fgRgb, bgRgb) };
  };
`;

export function buildMeasurePairExpression(
  textSelector: string,
  backdropSelector: string,
  label: string,
): string {
  return `${PREVIEW_BANNER_CONTRAST_ENGINE}
    (() => {
      const label = ${JSON.stringify(label)};
      const result = measureContrast(${JSON.stringify(textSelector)}, ${JSON.stringify(backdropSelector)});
      return { label, ...result };
    })()`;
}

export function buildMeasureButtonExpression(
  selector: string,
  backdropSelector: string,
  label: string,
): string {
  return `${PREVIEW_BANNER_CONTRAST_ENGINE}
    (() => {
      const label = ${JSON.stringify(label)};
      const result = measureButtonContrast(${JSON.stringify(selector)}, ${JSON.stringify(backdropSelector)});
      return { label, ...result };
    })()`;
}

export function buildMeasureBannerBundleExpression(
  textSelector: string,
  buttonSelector: string,
  backdropSelector: string,
  labelPrefix: string,
): string {
  return `${PREVIEW_BANNER_CONTRAST_ENGINE}
    (() => {
      const prefix = ${JSON.stringify(labelPrefix)};
      const text = measureContrast(${JSON.stringify(textSelector)}, ${JSON.stringify(backdropSelector)});
      const button = measureButtonContrast(${JSON.stringify(buttonSelector)}, ${JSON.stringify(backdropSelector)});
      return [
        { label: prefix + "/text", ...text },
        { label: prefix + "/button", ...button },
      ];
    })()`;
}
