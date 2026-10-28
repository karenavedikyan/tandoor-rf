var TT_DETAIL_ROUTE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail route QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  const openRoute = async () => {
    await page.locator('[data-tt="detail-route-disclosure"] summary').click();
    await page.locator('[data-tt="detail-route-grid"]').waitFor({ state: "visible" });
  };

  const routeLayout = async () =>
    page.evaluate(() => {
      const grid = document.querySelector('[data-tt="detail-route-grid"]');
      const task = document.querySelector('[data-tt="detail-task-card"], [data-tt="detail-task-former"], [data-tt="detail-task-readonly"]');
      const disc = document.querySelector('[data-tt="detail-route-disclosure"]');
      if (!grid || !task || !disc) return { ok: false };
      const current = grid.querySelector('[data-tt-route-variant="current"]');
      const name = current?.querySelector(".tt-route-name");
      const phone = current?.querySelector(".tt-route-phone");
      return {
        ok:
          task.compareDocumentPosition(disc) & Node.DOCUMENT_POSITION_FOLLOWING &&
          !!current &&
          name &&
          phone &&
          name.getBoundingClientRect().top <= phone.getBoundingClientRect().top,
        vw: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        nodes: grid.querySelectorAll('[data-tt="route-node"]').length,
      };
    });

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="detail-route-disclosure"]').evaluate((el) => !el.open), "route closed by default");
  const taskFirst = await page.evaluate(() => {
    const task = document.querySelector('[data-tt="detail-task-card"]');
    const route = document.querySelector('[data-tt="detail-route-disclosure"]');
    return !!(task && route && task.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(taskFirst, "task card precedes route disclosure");
  await openRoute();
  ok((await page.locator('[data-tt-route-variant="current"]').count()) === 1, "pending direct shows current holder node");
  ok((await page.locator('[data-tt="route-planned"]').count()) >= 1, "pending shows planned chip not confirmed custody");
  let lay = await routeLayout();
  ok(lay.ok && lay.nodes >= 2, "direct pending route has connected nodes with name above phone");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  lay = await routeLayout();
  ok(lay.scrollW <= lay.vw + 2, "375 light route no horizontal overflow");
  ok(lay.ok, "375 light route layout name/phone stack");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-021`);
  await page.reload();
  await openRoute();
  ok((await page.locator('[data-tt-route-variant="current"]').count()) === 1, "relay holder node present");
  ok((await page.locator('[data-tt-route-variant="final"]').count()) === 1, "relay final target without fake pending");
  ok((await page.locator('[data-tt="route-planned"]').count()) === 0, "no pending chip when no pendingId");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  await openRoute();
  ok((await page.locator('[data-tt-route-variant="delivered"]').count()) === 1, "completed shows delivered node");
  ok((await page.locator('[data-tt="route-planned"]').count()) === 0, "completed no planned next");
  ok((await page.locator('[data-tt-route-variant="current"]').count()) === 0, "completed no current holder row");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await openRoute();
  const desktop = await page.evaluate(() => {
    const grid = document.querySelector('[data-tt="detail-route-grid"]');
    const style = grid ? getComputedStyle(grid) : null;
    const conn = grid?.querySelector(".tt-route-connector");
    return {
      flexDir: style?.flexDirection,
      connDisplay: conn ? getComputedStyle(conn).flexDirection : null,
      contrast: (() => {
        const el = grid?.querySelector(".tt-route-name");
        if (!el) return 0;
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
        const fg = parse(getComputedStyle(el).color);
        let n = el.closest(".tt-route-node");
        let bg = n ? parse(getComputedStyle(n).backgroundColor) : null;
        if (!bg || bg.join("") === "0,0,0") bg = parse(getComputedStyle(document.body).backgroundColor);
        if (!fg || !bg) return 0;
        const L1 = lum(fg);
        const L2 = lum(bg);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      })(),
    };
  });
  ok(desktop.flexDir === "row", "desktop route grid horizontal when wide");
  ok(desktop.contrast >= 4.5, `dark route name contrast (${desktop.contrast.toFixed(2)})`);

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-002`);
  await page.reload();
  await openRoute();
  ok((await page.locator('[data-tt="route-phone"]').count()) >= 1, "read-only observer still sees route phones");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_ROUTE_QA, null, 2));
