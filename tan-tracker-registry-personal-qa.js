var TT_REGISTRY_PERSONAL_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Registry personal QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const visitor = "tt-registry-personal-qa-visitor1";
  const tableRow = (id) => page.locator(`#tt-registry-body tr[data-tt-open="${id}"]`);
  const waitMainHidden = async (id) => {
    await page.waitForFunction(
      (oid) => !document.querySelector(`#tt-registry-body tr[data-tt-open="${oid}"]`),
      id,
      { timeout: 15000 }
    );
  };

  await page.addInitScript((vid) => {
    window.__NOTIFICATION_DEMO_VISITOR__ = vid;
  }, visitor);
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await window.NotificationDemoStore.resetRemote();
  });

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-017`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "В мой архив", exact: true }).click();
  await page.locator('[data-tt="terminal-back-list"]').click();
  await page.locator('[data-tt="registry-shell"]').waitFor({ state: "visible" });
  ok((await tableRow("TT-2026-017").count()) === 0, "archived hidden on main list before reload");
  await page.reload();
  await page.locator('[data-tt="registry-shell"]').waitFor({ state: "visible" });
  await waitMainHidden("TT-2026-017");
  ok((await tableRow("TT-2026-017").count()) === 0, "cold reload hides archived row without manual RP init");

  await page.goto(`${base}/#tan-tracker?role=director&tt_id=TT-2026-005`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "В мой архив", exact: true }).click();
  await page.evaluate(() => window.NotificationDemoStore.flush());
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  await page.goto(`${base}/#tan-tracker?role=director`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await waitMainHidden("TT-2026-005");
  ok((await tableRow("TT-2026-005").count()) === 0, "archived row hidden on cold reload main list (UI table)");
  await page.getByRole("button", { name: /Архив \(\d+\)/ }).click();
  await tableRow("TT-2026-005").waitFor({ state: "visible" });
  ok((await tableRow("TT-2026-005").count()) === 1, "archived view shows record in main list UI");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-005`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  const m2On005 = page.locator('[data-tt="registry-personal-actions"]');
  ok((await m2On005.getByRole("button", { name: "В мой архив", exact: true }).count()) === 1, "participant with scope can archive completed");

  await page.goto(`${base}/#tan-tracker?role=director&tt_id=TT-2026-005`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  ok((await page.getByRole("button", { name: "Убрать из моего реестра" }).count()) === 0, "non-creator director no remove in disclosure");
  ok((await page.getByRole("button", { name: "В мой архив", exact: true }).count()) === 0, "already archived hides archive action");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-010`);
  await page.reload();
  await ttOpenOtherActions();
  ok((await page.getByRole("button", { name: "Убрать из моего реестра" }).count()) === 0, "non-creator m1 no remove when disclosure open");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-010`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  ok((await page.getByRole("button", { name: "Убрать из моего реестра", exact: true }).count()) === 1, "creator sees remove on own pending dispatch");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "Убрать из моего реестра", exact: true }).click();
  await page.getByRole("button", { name: "Убрать из реестра", exact: true }).click();
  await page.evaluate(() => window.NotificationDemoStore.flush());
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await waitMainHidden("TT-2026-001");
  ok((await tableRow("TT-2026-001").count()) === 0, "creator removed row hidden on cold reload");
  await page.locator('.tt-stat-tiles [data-tt="mine-handoff"]').click();
  await tableRow("TT-2026-001").waitFor({ state: "visible" });
  ok((await tableRow("TT-2026-001").count()) === 1, "removed creator-holder still in handoff actionable view");
  await tableRow("TT-2026-001").click();
  ok(await page.locator('[data-tt="detail"]').isVisible(), "detail still opens for removed with obligation");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_REGISTRY_PERSONAL_QA, null, 2));
