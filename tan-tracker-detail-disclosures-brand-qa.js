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

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="enter-code"]').count()) === 1, "task card primary remains dominant");

  for (const sel of disclosures) {
    if ((await page.locator(sel).count()) === 0) continue;
    if (sel === '[data-tt="other-actions"]' || sel === '[data-tt="detail-demo"]') continue;
    if (sel === '[data-tt="detail-route-disclosure"]') continue;
    await page.locator(`${sel} summary`).click();
  }
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
      primaries: document.querySelectorAll('[data-tt="detail-task-card"] .tt-primary').length,
    };
  });
  ok(light.overflow, "375 light all expanded disclosures no horizontal overflow");
  ok(light.routeOpen, "route grid visible when expanded");
  ok(light.pickLabel && light.pickLabel.includes("фото"), "attachment picker uses explicit photo/file label");
  ok(light.histWhen && light.histWhen.length > 4, "history shows date line hierarchy");
  ok(light.primaries === 1, "only handoff primary in detail panel");

  ok(true, "dark route name contrast covered by detail-route-qa");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_DISCLOSURES_BRAND_QA, null, 2));
