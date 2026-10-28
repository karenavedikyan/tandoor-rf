/** Browser-only: WCAG contrast using canvas color normalization + alpha compositing. */
window.ttQaColorToRgba = function ttQaColorToRgba(cssColor) {
  if (!cssColor || cssColor === "transparent") return [0, 0, 0, 0];
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

window.ttQaCompositeOver = function ttQaCompositeOver(top, bottom) {
  const outA = top[3] + bottom[3] * (1 - top[3]);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / outA,
    (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / outA,
    (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / outA,
    outA,
  ];
}

window.ttQaEffectiveBackground = function ttQaEffectiveBackground(el) {
  const layers = [];
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    const rgba = ttQaColorToRgba(bg);
    if (rgba[3] > 0.004) layers.unshift(rgba);
  }
  const rootBg = ttQaColorToRgba(getComputedStyle(document.documentElement).backgroundColor);
  let acc = rootBg[3] > 0.004 ? rootBg : ttQaColorToRgba(getComputedStyle(document.body).backgroundColor);
  for (const layer of layers) acc = ttQaCompositeOver(layer, acc);
  return acc;
}

window.ttQaRelativeLuminance = function ttQaRelativeLuminance(rgb) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

window.ttQaContrastRatioOnElement = function ttQaContrastRatioOnElement(textEl) {
  if (!textEl) return 0;
  const fgRaw = window.ttQaColorToRgba(getComputedStyle(textEl).color);
  const bgRaw = window.ttQaEffectiveBackground(textEl);
  const fg = window.ttQaCompositeOver(fgRaw, bgRaw);
  const L1 = window.ttQaRelativeLuminance(fg);
  const L2 = window.ttQaRelativeLuminance(bgRaw);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};
