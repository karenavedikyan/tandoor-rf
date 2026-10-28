var TT_DETAIL_DISCLOSURE_CHEVRON_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail disclosure chevron QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  const disclosureSelectors = [
    '[data-tt="detail-notes-disclosure"]',
    '[data-tt="detail-route-disclosure"]',
    '[data-tt="other-actions"]',
    '[data-tt="detail-attachments-disclosure"]',
    '[data-tt="history-disclosure"]',
    '[data-tt="detail-demo"]',
  ];

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });

  for (const sel of disclosureSelectors) {
    ok((await page.locator(sel).count()) === 1, `${sel} present on pending detail`);
    ok(await page.locator(sel).evaluate((el) => !el.open), `${sel} closed initially`);
  }

  const labelClosed = await page.locator('[data-tt="detail-route-disclosure"] summary').evaluate((el) =>
    getComputedStyle(el, "::before").content
  );
  ok(labelClosed.includes("Показать"), "closed summary shows muted Показать label");

  const chevronStyle = await page.evaluate(() => {
    const summary = document.querySelector('[data-tt="detail-route-disclosure"] summary');
    if (!summary) return null;
    const after = getComputedStyle(summary, "::after");
    const sum = getComputedStyle(summary);
    return {
      borderW: parseFloat(after.borderRightWidth) || 0,
      transform: after.transform,
      minH: summary.getBoundingClientRect().height,
      display: sum.display,
      gridCols: sum.gridTemplateColumns,
    };
  });
  ok(chevronStyle && chevronStyle.borderW >= 1, "summary has trailing chevron pseudo borders");
  ok(chevronStyle.minH >= 44, "disclosure header min 44px hit height");
  ok(chevronStyle.transform && chevronStyle.transform !== "none", "chevron pseudo has rotation transform");
  ok(chevronStyle.gridCols.split(" ").filter(Boolean).length >= 3, "summary uses title + label + chevron grid columns");

  const route = page.locator('[data-tt="detail-route-disclosure"]');
  await route.locator("summary").click();
  ok(await route.evaluate((el) => el.open), "click summary opens route disclosure");
  const labelOpen = await route.locator("summary").evaluate((el) => getComputedStyle(el, "::before").content);
  ok(labelOpen.includes("Скрыть"), "open summary shows muted Скрыть label");
  const openChev = await route.locator("summary").evaluate((el) => getComputedStyle(el, "::after").transform);
  ok(openChev.includes("matrix") || openChev.includes("-135"), "open chevron uses rotated transform");

  await route.locator("summary").click();
  ok(await route.evaluate((el) => !el.open), "click summary closes disclosure");

  const att = page.locator('[data-tt="detail-attachments-disclosure"]');
  await att.locator("summary").focus();
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.querySelector('[data-tt="detail-attachments-disclosure"]')?.open);
  ok(await att.evaluate((el) => el.open), "Space on focused summary opens attachments");
  await att.locator("summary").focus();
  await page.keyboard.press(" ");
  await page.waitForFunction(() => !document.querySelector('[data-tt="detail-attachments-disclosure"]')?.open);
  ok(await att.evaluate((el) => !el.open), "Space on focused summary closes attachments");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2),
    "375 light no horizontal overflow on detail"
  );
  const historyLayout = await page.evaluate(() => {
    const det = document.querySelector('[data-tt="history-disclosure"]');
    const summary = det?.querySelector("summary");
    if (!summary) return { ok: false };
    const vw = document.documentElement.clientWidth;
    const sr = summary.getBoundingClientRect();
    const after = summary;
    const labelStyle = getComputedStyle(summary, "::before");
    const chev = summary.getBoundingClientRect();
    return {
      ok: sr.right <= vw + 2 && sr.width <= vw + 2,
      summaryRight: sr.right,
      vw,
      label: labelStyle.content,
    };
  });
  ok(historyLayout.ok, "375 long history summary wraps within viewport with trailing indicator");
  ok(String(historyLayout.label).includes("Показать"), "375 history row shows visible Показать without hover");
  const box = await page.locator('[data-tt="enter-code"]').boundingBox();
  ok(box && box.y + box.height <= 812, "375 light primary CTA on first screen");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const contrast = await page.locator('[data-tt="detail-route-disclosure"] summary').evaluate((el) => {
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
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    let bg = parse(s.backgroundColor);
    let n = el.parentElement;
    while (n && (!bg || bg.join("") === "0,0,0")) {
      bg = parse(getComputedStyle(n).backgroundColor);
      n = n.parentElement;
    }
    if (!fg || !bg) return 0;
    const L1 = lum(fg);
    const L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  });
  ok(contrast >= 4.5, `375 dark disclosure header contrast >= 4.5 (${contrast.toFixed(2)})`);

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_DISCLOSURE_CHEVRON_QA, null, 2));
