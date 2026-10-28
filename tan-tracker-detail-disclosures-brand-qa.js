var TT_DETAIL_DISCLOSURES_BRAND_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail disclosures brand QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const disclosures = [
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
  ok((await page.locator('[data-tt="enter-code"]').count()) === 1, "task card primary remains dominant");

  for (const sel of disclosures) {
    if ((await page.locator(sel).count()) === 0) continue;
    await page.locator(`${sel} summary`).click();
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const light = await page.evaluate(() => {
    const panel = document.querySelector(".tt-detail-panel");
    const task = document.querySelector('[data-tt="detail-task-card"]');
    const route = document.querySelector('[data-tt="detail-route-grid"]');
    const pick = document.querySelector(".tt-att-add-btn");
    const hist = document.querySelector(".tt-timeline-entry");
    return {
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
      taskTop: task?.getBoundingClientRect().top,
      routeOpen: !!route,
      pickLabel: pick?.textContent?.trim(),
      histWhen: hist?.querySelector(".tt-timeline-when")?.textContent,
      primaries: document.querySelectorAll(".tt-detail-panel .tt-primary").length,
    };
  });
  ok(light.overflow, "375 light all expanded disclosures no horizontal overflow");
  ok(light.routeOpen, "route grid visible when expanded");
  ok(light.pickLabel && light.pickLabel.includes("фото"), "attachment picker uses explicit photo/file label");
  ok(light.histWhen && light.histWhen.length > 4, "history shows date line hierarchy");
  ok(light.primaries === 1, "only handoff primary in detail panel");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.locator('[data-tt="detail-route-disclosure"]').evaluate((el) => {
    if (!el.open) el.open = true;
  });
  await page.locator('[data-tt-route-variant="current"] .tt-route-name').first().waitFor({ state: "visible" });
  const dark = await page.evaluate(() => {
    const name = document.querySelector('[data-tt="detail-route-grid"] .tt-route-name');
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
    const node = name?.closest(".tt-route-node");
    const fg = name ? parse(getComputedStyle(name).color) : null;
    const bg = node ? parse(getComputedStyle(node).backgroundColor) : null;
    const ratio =
      fg && bg ? (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) : 0;
    return { ratio, overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2 };
  });
  ok(dark.overflow, "375 dark expanded stack no overflow");
  ok(dark.ratio >= 4.5, `375 dark route name contrast (${dark.ratio.toFixed(2)})`);

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_DISCLOSURES_BRAND_QA, null, 2));
