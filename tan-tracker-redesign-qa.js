var TT_REDESIGN_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker redesign QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const viewports = [
    [360, "360"],
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
      if (theme === "dark") {
        const contrast = await page.evaluate(() => {
          const av = document.querySelector(".tt-avatar");
          if (!av) return null;
          const s = getComputedStyle(av);
          const bg = s.backgroundColor;
          const fg = s.color;
          const parse = (c) => {
            const m = c.match(/[\d.]+/g);
            if (!m) return null;
            return m.slice(0, 3).map(Number);
          };
          const L = (rgb) => {
            const [r, g, b] = rgb.map((v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const bgr = parse(bg);
          const fgr = parse(fg);
          if (!bgr || !fgr) return null;
          const l1 = L(bgr);
          const l2 = L(fgr);
          const hi = Math.max(l1, l2);
          const lo = Math.min(l1, l2);
          return (hi + 0.05) / (lo + 0.05);
        });
        ok(contrast != null && contrast >= 4.5, `${label} dark: avatar initials contrast >= 4.5 (${contrast?.toFixed?.(2)})`);
      }
    }
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-003`);
  await page.reload();
  const due = await page.locator('[data-tt="detail"]').textContent();
  ok(due.toLowerCase().includes("просроч"), "TT-2026-003 shows human overdue wording");
  ok(!due.includes("до завтра до"), "detail due avoids double «до»");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  ok(await page.locator('[data-tt="detail-mobile-dock"]').evaluate((el) => el.hidden), "dock hidden while hero primary visible");
  await page.locator('[data-tt="enter-code"][data-tt-detail-hero-primary]').first().click();
  const cells = page.locator('[data-tt="code-cells"] .tt-code-cell');
  ok((await cells.count()) === 6, "code screen shows 6 visual cells");
  const inputVis = await page.locator('[data-tt="code-input"]').evaluate((el) => {
    const s = getComputedStyle(el);
    return Number(s.opacity) === 0;
  });
  ok(inputVis, "code native input visually hidden");
  await page.locator('[data-tt="code-input"]').fill("123");
  ok(
    await page.evaluate(() => {
      const input = document.querySelector('[data-tt="code-input"]');
      const cells = [...document.querySelectorAll('[data-tt="code-cells"] .tt-code-cell')].map((c) => c.textContent);
      return input?.value === "123" && cells.join("") === "123";
    }),
    "code cells mirror single code input"
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-facts"]').count()) === 1, "desktop detail shows facts aside card");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  const before = await page.locator('[data-tt-registry-section="action"] .tt-card-v2').count();
  await page.locator('.tt-stat-tile[data-tt="mine-handoff"]').click();
  const after = await page.locator(".tt-card-v2, .tt-table tbody tr").count();
  ok(after <= before + 2, "handoff tile filters registry list");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_REDESIGN_QA, null, 2));
