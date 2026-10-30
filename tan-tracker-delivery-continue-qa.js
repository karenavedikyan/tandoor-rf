var TT_DELIVERY_CONTINUE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Delivery continue QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(code);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail-task-delivered-close"]').waitFor({ state: "visible" });

  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").status)) === "delivered",
    "final confirm sets delivered not completed"
  );

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_emp=m1&tt_act=ext_01&tt_id=TT-2026-001";
  });
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="holder-delivered"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="transfer"]').count() >= 1, "external transfer control");

  await page.locator('[data-tt="transfer"]').click();
  ok((await page.locator('[data-tt-pick]').first().textContent()).includes("Вернуть"), "return creator first");

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001";
  });
  await page.getByRole("button", { name: "Завершить передачу", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
  ok((await page.locator(".tt-detail-task-heading").textContent()).includes("Передача завершена"), "explicit complete");

  await page.locator('[data-tt="preview-recipient-received"]').click();
  const bot = await page.locator('[data-tt="bot-message-preview"] pre').textContent();
  ok(bot.includes("Передача дошла до вас") && bot.includes("делать ничего не нужно"), "bot received copy");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DELIVERY_CONTINUE_QA, null, 2));
