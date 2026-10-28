var TT_REDESIGN_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker redesign QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const tileWidths = [360, 375, 390, 430];
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
          const parse = (c) => c.match(/[\d.]+/g)?.slice(0, 3).map(Number) || null;
          const L = (rgb) => {
            const [r, g, b] = rgb.map((v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const bgr = parse(s.backgroundColor);
          const fgr = parse(s.color);
          if (!bgr || !fgr) return null;
          const hi = Math.max(L(bgr), L(fgr));
          const lo = Math.min(L(bgr), L(fgr));
          return (hi + 0.05) / (lo + 0.05);
        });
        ok(contrast != null && contrast >= 4.5, `${label} dark: avatar initials contrast >= 4.5 (${contrast?.toFixed?.(2)})`);
      }
    }
  }

  for (const w of tileWidths) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: w, height: 812 });
      await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
      await page.reload();
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll(".tt-stat-tile-label")].some((el) => {
          const s = getComputedStyle(el);
          return el.scrollWidth > el.clientWidth + 1 || /\u2026/.test(el.textContent || "");
        })
      );
      ok(!clipped, `${w}px ${theme}: stat tile labels not clipped`);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  const ctaRight = await page.evaluate(() => {
    const row = document.querySelector(".tt-registry-head-row");
    const cta = document.querySelector(".tt-head-cta-desktop");
    if (!row || !cta) return false;
    const rr = row.getBoundingClientRect();
    const cr = cta.getBoundingClientRect();
    return cr.right >= rr.right - 4 && cr.left > rr.left + rr.width * 0.45;
  });
  ok(ctaRight, "1440: create CTA aligned to right of header row");

  await page.setViewportSize({ width: 390, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  ok((await page.locator(".tt-demo-head-popover").count()) === 1, "390 detail: single demo popover in header");
  ok((await page.locator(".tt-demo-settings:not(.tt-demo-head-popover)").count()) === 0, "390 detail: no legacy demo settings row");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-003`);
  await page.reload();
  const due = await page.locator('[data-tt="detail"]').textContent();
  ok(due.toLowerCase().includes("просроч"), "TT-2026-003 shows human overdue wording");
  ok(!due.includes("до завтра до"), "detail due avoids double «до»");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator('[data-tt="mine-overdue"]').click();
  const rowDue = await page.locator('.tt-table tbody tr[data-tt-open="TT-2026-003"] .tt-table-due').textContent();
  ok(rowDue.toLowerCase().includes("просрочено на"), "table overdue cell includes «просрочено на» for TT-2026-003");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  ok(await page.locator('[data-tt="detail-mobile-dock"]').evaluate((el) => el.hidden), "dock hidden while hero primary visible");
  await page.locator('[data-tt="enter-code"][data-tt-detail-hero-primary]').first().click();
  const cells = page.locator('[data-tt="code-cells"] .tt-code-cell');
  ok((await cells.count()) === 6, "code screen shows 6 visual cells");
  ok(
    await page.locator('[data-tt="code-input"]').evaluate((el) => Number(getComputedStyle(el).opacity) === 0),
    "code native input visually hidden"
  );
  await page.locator('[data-tt="code-input"]').fill("123");
  ok(
    await page.evaluate(() => {
      const input = document.querySelector('[data-tt="code-input"]');
      const cells = [...document.querySelectorAll('[data-tt="code-cells"] .tt-code-cell')].map((c) => c.textContent);
      return input?.value === "123" && cells.join("") === "123";
    }),
    "code cells mirror single code input"
  );
  ok((await page.locator(".tt-demo-head-popover").count()) === 1, "code view: compact demo pill in header");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-facts"]').count()) === 1, "desktop detail shows facts aside card");
  ok((await page.locator('[data-tt="registry-status-chips"]').count()) === 0, "status chips hidden on detail view");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  ok((await page.locator('[data-tt="registry-status-chips"]').count()) >= 1, "desktop registry shows status filter chips");
  const before = await page.locator('[data-tt-registry-section="action"] .tt-card-v2').count();
  await page.locator('.tt-stat-tile[data-tt="mine-handoff"]').click();
  const after = await page.locator(".tt-card-v2, .tt-table tbody tr").count();
  ok(after <= before + 2, "handoff tile filters registry list");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_REDESIGN_QA, null, 2));
