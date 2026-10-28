var TT_WIZ_RELAY_COPY_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard relay copy QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const waitReview = async () => {
    await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  };

  const assertHandoffLayout = async (label) => {
    const layout = await page.evaluate(() => {
      const row = document.querySelector('[data-tt="route-stop-final"]');
      const btn = row?.querySelector('[data-tt="create-edit-relay"]');
      const hint = row?.querySelector(".tt-wizard-review-handoff-hint");
      if (!row || !btn || !hint) return { ok: false };
      const br = btn.getBoundingClientRect();
      const hr = hint.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      return {
        ok: br.right <= vw + 1 && br.bottom <= hr.bottom + 2 && br.width >= 44 && br.height >= 44,
        btnRight: br.right,
        vw,
      };
    });
    ok(layout.ok, `${label}: relay CTA fits viewport without overlapping hint`);
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Relay copy QA direct");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await ttOpenRecipientList();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей Приёмка" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();

  const reviewDirect = await page.locator('[data-tt="wizard-review"]').textContent();
  ok(reviewDirect.includes("Получатель") && reviewDirect.includes("Отправитель"), "review route role labels");
  ok(reviewDirect.includes("Сергей Приёмка"), "direct handoff shows final recipient name");
  ok(reviewDirect.includes("79000000001") || reviewDirect.includes("+7"), "direct handoff shows final phone");
  ok(reviewDirect.includes("напрямую, без посредника"), "direct handoff helper");
  ok(!reviewDirect.includes("Напрямую конечному"), "no abstract direct label");
  ok((await page.getByRole("button", { name: "Передать через другого человека", exact: true }).count()) === 1, "relay CTA on direct path");

  await page.setViewportSize({ width: 375, height: 812 });
  await assertHandoffLayout("375px light");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await assertHandoffLayout("375px dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "";
  });
  await assertHandoffLayout("desktop");

  await page.locator('[data-tt="create-edit-relay"]').click();
  await page.locator('[data-create-phase="relay-pick"]').waitFor({ state: "visible" });
  ok(
    (await page.locator('[data-create-phase="relay-pick"] .tt-wizard-title').textContent()).includes(
      "Кому отдадите для дальнейшей передачи"
    ),
    "relay-pick step title"
  );
  ok((await page.locator(".tt-wizard-hint").textContent()).includes("Сергей"), "relay-pick explains onward to final recipient");
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();

  const reviewRelay = await page.locator('[data-tt="wizard-review"]').textContent();
  ok(reviewRelay.includes("Наталья Савельева"), "relay handoff shows intermediary name");
  ok(reviewRelay.includes("передать предмет дальше"), "relay handoff helper");
  ok(reviewRelay.includes("Сергей Приёмка"), "relay helper names final recipient");
  const deliverRow = await page.locator('[data-tt="route-stop-final"]').textContent();
  ok(deliverRow.includes("Сергей Приёмка"), "final recipient unchanged after relay pick");
  ok(
    (await page.locator('[data-tt="review-handoff"] [data-tt="create-edit-relay"]').textContent()) === "Изменить",
    "relay path uses Изменить on handoff row"
  );

  await page.locator('[data-tt="create-edit-item"]').click();
  await page.locator('[data-tt-field="item"]').fill("Relay copy QA relay chain");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "relay-copy.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("relay chain"), "edit item preserved through relay flow");
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("1 файл"), "staged file preserved after edit loops");

  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("relay chain"), "relay order created");

  await page.locator('[data-tt="back-list"]').click();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Relay copy QA direct order");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Ольга Магазин" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("Ольга Магазин"), "second order direct final on route card");
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("direct order"), "direct order created without relay");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_RELAY_COPY_QA, null, 2));
