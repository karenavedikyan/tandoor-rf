var TT_REGISTRY_PERSONAL_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Registry personal QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const visitor = "tt-registry-personal-qa-visitor1";
  await page.addInitScript((vid) => {
    window.__NOTIFICATION_DEMO_VISITOR__ = vid;
  }, visitor);
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await window.TtRegistryPersonal.ready();
    window.TtRegistryPersonal._testReset();
    await window.NotificationDemoStore.resetRemote();
  });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "В мой архив", exact: true }).click();
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  ok((await page.locator('[data-tt-open="TT-2026-009"]').count()) === 0, "archived completed hidden from main registry");
  await page.getByRole("button", { name: /Архив/ }).click();
  ok((await page.locator('[data-tt-open="TT-2026-009"]').count()) === 1, "archived view shows record");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-017`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "В мой архив", exact: true }).click();
  await page.evaluate(async () => {
    await window.NotificationDemoStore.flush();
  });
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.locator('[data-tt-open="TT-2026-017"]').count()) === 0, "cold reload hides archived row without manual RP.init");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-017`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  ok((await page.getByRole("button", { name: "Убрать из моего реестра" }).count()) === 0, "non-creator overflow has no remove");
  ok((await page.getByRole("button", { name: "В мой архив", exact: true }).count()) === 1, "non-creator can archive completed in scope");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-010`);
  await page.reload();
  ok((await page.locator('[data-tt="registry-remove-ask"]').count()) === 0, "non-creator no remove control on list");
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-010`);
  await page.reload();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  ok((await page.getByRole("button", { name: "Убрать из моего реестра" }).count()) === 1, "creator sees remove on own dispatch");
  await page.getByRole("button", { name: "Убрать из моего реестра", exact: true }).click();
  await page.getByRole("button", { name: "Убрать из реестра", exact: true }).click();
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3`);
  await page.reload();
  ok((await page.locator('[data-tt-open="TT-2026-010"]').count()) === 0, "removed hidden for initiator main list");
  await page.evaluate(async () => {
    await window.NotificationDemoStore.flush();
  });
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  await page.reload();
  ok((await page.locator('[data-tt-open="TT-2026-010"]').count()) === 0, "removed flag persists after reload");
  await page.getByRole("button", { name: /Удалённые/ }).click();
  await page.locator('[data-tt-open="TT-2026-010"]').click();
  await page.locator('summary[aria-label="Ещё действия"]').click();
  await page.getByRole("button", { name: "Восстановить в реестре", exact: true }).click();
  await page.locator('[data-tt="back-list"]').click();
  await page.getByRole("button", { name: /Основной реестр|Мой реестр|← Основной реестр/ }).first().click();
  ok((await page.locator('[data-tt-open="TT-2026-010"]').count()) === 1, "restore returns row to main registry");
  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_REGISTRY_PERSONAL_QA, null, 2));
