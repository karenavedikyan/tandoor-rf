var TT_PRE_HANDOFF_EDIT_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Pre-handoff edit QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok(await page.evaluate(() => window.TanTrackerPrototype.canFullEditOrder("TT-2026-001")), "initiator holder can full-edit before confirm");
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const codeOld = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  ok(/^\d{6}$/.test(codeOld), "code issued before edit");
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.getByRole("button", { name: "Изменить передачу", exact: true }).click();
  await page.locator('[data-tt="create-wizard"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Изменить предмет", exact: true }).click();
  await page.locator('[data-tt-field="item"]').fill("Договор поставки №24/К — правка");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByRole("button", { name: "Изменить срок доставки", exact: true }).click();
  const dueVal = "2026-11-15T14:30";
  await page.locator('[data-tt-field="due"]').fill(dueVal);
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  const hvBefore = await page.evaluate(
    () => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").handoffVer
  );
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-detail-title").textContent()).includes("правка"), "same id detail shows edited title");
  ok(
    (await page.evaluate(
      () => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").handoffVer
    )) > hvBefore,
    "metadata-only save bumps handoff version"
  );
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").id)) === "TT-2026-001",
    "save keeps same transfer id"
  );
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(codeOld);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).length > 5, "old code rejected after edit");
  await page.locator('[data-tt="detail"]').click();
  await page.getByRole("button", { name: "Сменить получателя", exact: true }).click();
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const codeNew = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  ok(codeNew !== codeOld, "new recipient gets fresh code");
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(codeNew);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").holderId)) === "ext_02",
    "new recipient code completes handoff once"
  );
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-002`);
  await page.reload();
  ok(!(await page.evaluate(() => window.TanTrackerPrototype.canFullEditOrder("TT-2026-002"))), "non-initiator holder denied full edit");
  ok((await page.locator('[data-tt="order-full-edit"]').count()) === 0, "no full-edit control for non-initiator");
  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_PRE_HANDOFF_EDIT_QA, null, 2));
