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
    const el = grid?.querySelector(".tt-route-name");
    const contrast =
      el && typeof ttQaContrastRatioOnElement === "function" ? ttQaContrastRatioOnElement(el) : 0;
    return {
      flexDir: style?.flexDirection,
      connDisplay: conn ? getComputedStyle(conn).flexDirection : null,
      contrast,
    };
  });
  ok(desktop.flexDir === "row", "desktop route grid horizontal when wide");
  ok(desktop.contrast >= 4.5, `dark route name contrast (${desktop.contrast.toFixed(2)})`);

  const tripleLayoutAt = async (vw, label) => {
    await page.setViewportSize({ width: vw, height: 812 });
    await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-018`);
    await page.reload();
    await openRoute();
    ok((await page.locator('[data-tt-route-nodes="3"]').count()) === 1, `${label}: three-node relay route`);
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector('[data-tt="detail-route-grid"]');
      const style = grid ? getComputedStyle(grid) : null;
      const names = [...(grid?.querySelectorAll(".tt-route-name") || [])].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, text: el.textContent?.trim() };
      });
      const conn = grid?.querySelector(".tt-route-connector");
      const connBox = conn?.getBoundingClientRect();
      const gridBox = grid?.getBoundingClientRect();
      const connInside =
        connBox && gridBox
          ? connBox.left >= gridBox.left - 2 && connBox.right <= gridBox.right + 2
          : true;
      return { flexDir: style?.flexDirection, names, connInside, scrollW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
    });
    ok(metrics.flexDir === "column", `${label}: triple route stays vertical in panel`);
    ok(metrics.names.every((n) => n.w >= 72 && (n.text?.length || 0) >= 2), `${label}: route names readable width`);
    ok(metrics.connInside && metrics.scrollW <= metrics.vw + 2, `${label}: connectors in grid, no overflow`);
  };
  await tripleLayoutAt(375, "375");
  await tripleLayoutAt(520, "520");
  await tripleLayoutAt(1440, "1440");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-002`);
  await page.reload();
  await openRoute();
  ok((await page.locator('[data-tt="route-phone"]').count()) >= 1, "read-only observer still sees route phones");
  const tel = await page.locator('[data-tt="route-phone"]').first();
  const href = await tel.getAttribute("href");
  const visible = (await tel.textContent()).trim();
  ok(href && /^tel:\+\d{11}$/.test(href) && href.startsWith("tel:+7"), "tel href is tel:+ plus 11 normalized digits");
  ok(!/tel:\+77\d{9}/.test(href || ""), "tel href does not duplicate country code");
  const hrefDigits = (href || "").replace(/^tel:\+/, "");
  const displayDigits = visible.replace(/\D/g, "");
  ok(
    hrefDigits.length === 11 &&
      displayDigits.length >= 10 &&
      hrefDigits.slice(-10) === displayDigits.slice(-10),
    "tel href matches displayed normalized phone (no dial)"
  );

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_ROUTE_QA, null, 2));
