var TT_WIZ_RECIPIENT_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard recipient choose QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Recipient choose QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });

  ok((await page.locator('[data-tt="recipient-choose"]').count()) === 1, "step3 starts with two choice cards not open list");
  ok((await page.locator('[data-tt="contact-pick"]').count()) === 0, "contact list hidden initially");
  ok((await page.locator('[data-tt="create-recipient-browse"]').count()) === 1, "Выбрать из списка present");

  ok((await page.getByRole("button", { name: "Далее", exact: true }).count()) === 0, "Далее hidden until recipient confirmed");
  await page.locator('[data-tt="create-recipient-browse"]').click();
  await page.locator('[data-tt="contact-pick"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("получ"), "Далее on list blocked until pick");
  await page.locator('[data-tt="create-recipient-back-choose"]').click();
  await page.locator('[data-tt="recipient-choose"]').waitFor({ state: "visible" });

  await page.locator('[data-tt="create-recipient-browse"]').click();
  await page.locator('[data-tt="contact-pick"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-wizard-contact").count()) > 5, "browse opens searchable directory");

  await page.locator('[data-tt-field="pickQ"]').fill("zzz-no-match-qa");
  await page.locator('[data-tt="contact-pick-empty"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="contact-pick-empty"]').textContent()).includes("Никого не найдено"), "empty search feedback");

  await page.locator('[data-tt="create-recipient-back-choose"]').click();
  await page.locator('[data-tt="recipient-choose"]').waitFor({ state: "visible" });

  await page.locator('[data-tt="create-recipient-browse"]').click();
  await page.locator('[data-tt-field="pickQ"]').fill("");
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей Приёмка" }).first().click();
  await page.locator('[data-tt="recipient-selected"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-wizard-recipient-selected-name").textContent()).includes("Сергей"), "selected summary shows name");

  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="create-edit-recipient"]').click();
  await page.locator('[data-tt="recipient-selected"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-wizard-recipient-selected-name").textContent()).includes("Сергей"), "edit recipient preserves selection summary");

  await page.locator('[data-tt="create-recipient-change"]').click();
  await page.locator('[data-tt="contact-pick"]').waitFor({ state: "visible" });
  await page.locator(".tt-wizard-contact").filter({ hasText: "Ольга" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="route-stop-final"]').textContent()).includes("Ольга"), "change recipient updates review route");

  await ttExitWizardToRegistry();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Recipient new path");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-tt="recipient-choose"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="recipient-choose"] [data-tt="create-new-recipient"]').click();
  await page.locator('[data-create-phase="recipient-new-name"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="newName"]').fill("Choose QA Новый");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt-field="newPhone"]').fill("79000000881");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="route-stop-final"]').textContent()).includes("Choose QA Новый"), "new recipient on review route");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_RECIPIENT_QA, null, 2));
