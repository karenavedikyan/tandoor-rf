var TT_REDESIGN_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker redesign QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const viewports = [
    [375, "375"],
    [390, "390"],
    [430, "430"],
    [768, "768"],
    [1024, "1024"],
    [1440, "1440"],
  ];

  for (const [w, label] of viewports) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: w, height: 812 });
      await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
      await page.reload();
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.locator("#tt-root").waitFor({ state: "visible" });
      ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2),
        `${label} ${theme}: registry no horizontal overflow`
      );
      ok((await page.locator('[data-tt="registry-stats"]').count()) >= 1, `${label} ${theme}: stat tiles present`);
    }
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-003`);
  await page.reload();
  const due = await page.locator('[data-tt="detail"]').textContent();
  ok(due.toLowerCase().includes("просроч"), "TT-2026-003 shows human overdue wording");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="enter-code"]').click();
  const cells = page.locator('[data-tt="code-cells"] .tt-code-cell');
  ok((await cells.count()) === 6, "code screen shows 6 visual cells");
  await page.locator('[data-tt="code-input"]').fill("123");
  ok(
    await page.evaluate(() => {
      const input = document.querySelector('[data-tt="code-input"]');
      const cells = [...document.querySelectorAll('[data-tt="code-cells"] .tt-code-cell')].map((c) => c.textContent);
      return input?.value === "123" && cells.join("") === "123";
    }),
    "code cells mirror single code input"
  );

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  const before = await page.locator('[data-tt-registry-section="action"] .tt-card-v2').count();
  await page.locator('.tt-stat-tile[data-tt="mine-handoff"]').click();
  const after = await page.locator(".tt-card-v2, .tt-table tbody tr").count();
  ok(after <= before + 2, "handoff tile filters registry list");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_REDESIGN_QA, null, 2));
