var TT_WIZ_REVIEW_LABELS_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard review labels QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const waitReview = async () => {
    await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  };

  const reviewLinkTexts = async () =>
    page.locator('[data-tt="wizard-review"] .tt-wizard-review-link').allTextContents();

  const assertNoGenericReviewLinks = async (label) => {
    const texts = (await reviewLinkTexts()).map((t) => t.trim());
    ok(!texts.some((t) => t === "Добавить" || t === "Изменить"), `${label}: no standalone Добавить/Изменить on review`);
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Label QA item");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await ttOpenRecipientList();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей Приёмка" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();

  const emptyLabels = (await reviewLinkTexts()).map((t) => t.trim());
  ok(emptyLabels.includes("Изменить предмет"), "empty review shows Изменить предмет");
  ok(emptyLabels.includes("Выбрать другого получателя"), "empty review shows Выбрать другого получателя on route");
  ok(emptyLabels.includes("Указать срок доставки"), "empty due shows Указать срок доставки");
  ok(emptyLabels.includes("Добавить фото или файл"), "empty files shows Добавить фото или файл");
  ok(emptyLabels.includes("Добавить комментарий"), "empty comment shows Добавить комментарий");
  await assertNoGenericReviewLinks("empty review");

  await page.locator('[data-tt="create-edit-item"]').click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt-field="item"]').inputValue()) === "Label QA item", "edit item preserves value");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();

  await page.locator('[data-tt="create-edit-recipient"]').click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="recipient-selected"]').textContent()).includes("Сергей"), "edit recipient preserves selection");
  await page.locator('[data-tt="create-wizard-back"]').click();
  await waitReview();

  await page.locator('[data-tt="create-edit-due"]').click();
  await page.locator('[data-create-phase="edit-due"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="due"]').fill("2033-06-15T10:00");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();

  await page.locator('[data-tt="create-edit-files"]').click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "label-qa.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();

  await page.locator('[data-tt="create-edit-comment"]').click();
  await page.locator('[data-create-phase="edit-comment"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="comment"]').fill("Review label comment");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();

  const filledLabels = (await reviewLinkTexts()).map((t) => t.trim());
  ok(filledLabels.includes("Изменить срок доставки"), "filled due shows Изменить срок доставки");
  ok(filledLabels.includes("Изменить фото и файлы"), "filled files shows Изменить фото и файлы");
  ok(filledLabels.includes("Изменить комментарий"), "filled comment shows Изменить комментарий");
  await assertNoGenericReviewLinks("filled review");
  const reviewBody = await page.locator('[data-tt="wizard-review"]').textContent();
  ok(reviewBody.includes("2033") && reviewBody.includes("1 файл") && reviewBody.includes("Review label comment"), "filled values retained on review");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2),
    "375 light review no horizontal overflow"
  );
  const layout375 = await page.evaluate(() => {
    const itemTitle = document.querySelector(".tt-wizard-review-item-title");
    const link = document.querySelector('[data-tt="create-edit-comment"]');
    if (!itemTitle || !link) return { ok: false };
    const ir = itemTitle.getBoundingClientRect();
    const lr = link.getBoundingClientRect();
    return { ok: lr.top >= ir.top - 4, linkRight: lr.right, vw: document.documentElement.clientWidth };
  });
  ok(layout375.ok && layout375.linkRight <= layout375.vw + 2, "375 comment action stays in viewport near its block");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const primaries = await page.locator(".tt-wizard-actions .tt-primary").count();
  ok(primaries === 1, "only Создать передачу uses bright primary");
  ok((await page.locator('[data-tt="create-wizard-submit"]').textContent()).includes("Создать передачу"), "submit label unchanged");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_REVIEW_LABELS_QA, null, 2));
