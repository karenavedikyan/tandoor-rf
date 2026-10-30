var TT_CONTACTS_DEDUPE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Contacts dedupe QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator('[data-tt="transfer"]').click();
  ok((await page.locator('[data-tt="contact-pick"]').textContent()).includes("Сотрудники · справочник компании"), "group caption employees");
  await page.locator('[data-tt="toggle-new"]').click();
  await page.locator('[data-tt-field="newPhone"]').fill("9001234021");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok(await page.locator('[data-tt="contact-exists"]').isVisible(), "transferView phone-first exists");
  ok((await page.locator('[data-tt="contact-exists"]').textContent()).includes("сотрудник"), "employee number in exists block");
  await page.locator('[data-tt="pick-existing"]').click();
  ok((await page.locator('[data-tt="contact-pick"] [aria-pressed="true"]').count()) >= 1, "transfer pick existing");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Dedupe QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="create-new-recipient"]').first().click();
  await page.locator('[data-tt-field="newPhone"]').fill("9000000001");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok(await page.locator('[data-tt="contact-exists"]').isVisible(), "wizard existing number");
  await page.locator('[data-tt="pick-existing-wizard"]').click();
  ok(await page.locator('[data-tt="recipient-selected"]').isVisible(), "wizard pick existing");

  const before = await page.evaluate(() => window.TanTrackerPrototype.contacts().length);
  await page.locator('[data-tt="create-recipient-change"]').click();
  await page.locator('[data-tt="create-new-recipient"]').first().click();
  await page.locator('[data-tt-field="newPhone"]').fill("9009998870");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok(await page.locator('[data-tt="contact-new"]').isVisible(), "new number badge");
  await page.locator('[data-tt-field="newName"]').fill("Dedupe Новый");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  const after = await page.evaluate(() => window.TanTrackerPrototype.contacts().length);
  ok(after === before + 1, "single new contact created");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_CONTACTS_DEDUPE_QA, null, 2));
