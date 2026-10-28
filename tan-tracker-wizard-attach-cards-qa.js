var TT_WIZ_ATT_CARDS_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard attach cards QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const txtPayload = "wizard attach bytes QA";

  const contrastRatio = (fg, bg) => {
    const parse = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const f = parse(fg);
    const b = parse(bg);
    if (!f || !b) return 0;
    const L1 = lum(f);
    const L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };

  const assertActionContrast = async (label) => {
    const ratio = await page.evaluate(() => {
      const el = document.querySelector(".tt-att-action");
      if (!el) return 0;
      let n = el;
      let bg = "";
      while (n) {
        bg = getComputedStyle(n).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        n = n.parentElement;
      }
      return (function contrastRatio(fg, bgC) {
        const parse = (c) => {
          const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [+m[1], +m[2], +m[3]] : null;
        };
        const lum = ([r, g, b]) => {
          const f = (v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const f = parse(fg);
        const b = parse(bgC);
        if (!f || !b) return 0;
        const L1 = lum(f);
        const L2 = lum(b);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      })(getComputedStyle(el).color, bg || getComputedStyle(document.body).backgroundColor);
    });
    ok(ratio >= 4.5, `${label}: attachment action contrast >= 4.5 (${ratio.toFixed(2)})`);
  };

  const goFiles = async () => {
    await page.locator('[data-tt="create"]').click();
    await page.locator('[data-tt-field="item"]').fill("Attach cards QA");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  };

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await goFiles();
  ok((await page.locator(".tt-att-block--cards").count()) >= 1, "wizard files step uses card attachment block");

  const longName =
    "Очень-длинное-имя-файла-для-проверки-переноса-без-горизонтального-скролла-в-шаге-два-мастера.png";
  await page.locator('[data-tt="attach-input"]').setInputFiles([
    { name: "card-photo.png", mimeType: "image/png", buffer: Buffer.from(png1x1, "base64") },
    { name: longName, mimeType: "image/png", buffer: Buffer.from(png1x1, "base64") },
  ]);
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="attach-list"] .tt-att-item').count()) === 2, "two staged files render");
  await ttWaitAttThumbLoaded();
  const nw = await page.locator(".tt-att-thumb img").first().evaluate((img) => img.naturalWidth);
  ok(nw > 0, "valid thumbnail naturalWidth>0 after load settles");

  ok((await page.locator(".tt-att-action-label", { hasText: "Открыть" }).count()) >= 1, "Открыть label visible");
  ok((await page.locator(".tt-att-action-label", { hasText: "Скачать" }).count()) >= 2, "Скачать labels on items");
  ok((await page.locator(".tt-att-action-label", { hasText: "Убрать" }).count()) === 2, "Убрать on staged items");

  const actionBox = await page.locator(".tt-att-action").first().boundingBox();
  ok(actionBox && actionBox.height >= 44, "action chip min 44px height");

  await page.setViewportSize({ width: 375, height: 812 });
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok(noOverflow, "375px wizard files no horizontal overflow with long filename");
  await assertActionContrast("375 light");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await assertActionContrast("375 dark");

  await page.locator(".tt-att-item").last().scrollIntoViewIfNeeded();
  await page.locator(".tt-att-item").last().locator(".tt-att-action--remove").focus();
  ok(await page.evaluate(() => document.activeElement?.classList.contains("tt-att-action")), "remove action focusable");

  await page.evaluate(() => {
    const img = document.querySelector(".tt-att-thumb img");
    if (img && window.TanTrackerAttachments?.onThumbError) {
      window.TanTrackerAttachments.onThumbError(img);
    }
  });
  await page.locator(".tt-att-thumb--fallback").first().waitFor({ state: "attached" });
  ok(
    await page.evaluate(() => {
      const thumb = document.querySelector(".tt-att-thumb--fallback");
      const img = thumb?.querySelector("img:not(.tt-att-img-broken)");
      const vis = img && getComputedStyle(img).display !== "none";
      const fb = thumb?.querySelector(".tt-att-fallback");
      return !vis && fb && getComputedStyle(fb).display !== "none";
    }),
    "broken image shows type fallback without visible broken img"
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".tt-att-item").filter({ hasText: "card-photo" }).locator('[data-tt="attach-download"]').click(),
  ]);
  const dlStream = await download.createReadStream();
  const chunks = [];
  for await (const c of dlStream) chunks.push(c);
  ok(Buffer.concat(chunks).length > 0, "download returns actual bytes");

  await page.locator(".tt-att-item").filter({ hasText: "card-photo" }).locator('[data-tt="attach-remove"]').click();
  ok((await page.locator('[data-tt="attach-list"] .tt-att-item').count()) === 1, "remove one retains other draft file");
  ok((await page.locator('[data-tt="attach-list"]').textContent()).includes("Очень-длинное"), "remaining long-name file kept in draft");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "";
  });
  await assertActionContrast("1440 light");

  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await ttOpenRecipientList();
  await page.locator(".tt-wizard-contact").first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("1 файл"), "review retains one file after remove");

  await ttExitWizardToRegistry();
  await page.locator('[data-tt-open="TT-2026-001"]').first().click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-att-compact .tt-att-action").count()) >= 1, "detail compact uses action chips");
  ok((await page.locator('.tt-att-compact [data-tt="attach-remove"]').count()) === 0, "detail persisted attachments omit remove");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_ATT_CARDS_QA, null, 2));
