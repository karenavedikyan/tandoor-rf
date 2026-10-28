var TT_WIZ_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const waitCreatePhase = async (phase) => {
    await page.locator(`[data-tt="create-wizard"][data-create-phase="${phase}"]`).waitFor({ state: "visible" });
  };
  const waitWizardTitle = async (phase, title) => {
    await waitCreatePhase(phase);
    await page.locator(`[data-create-phase="${phase}"] .tt-wizard-title`).filter({ hasText: title }).waitFor({ state: "visible" });
  };

  const startCreate = async () => {
    await page.locator('[data-tt="create"]').click();
    await waitWizardTitle("item", "Что передаём");
    ok((await page.locator(".tt-wizard-progress").textContent()).includes("Шаг 1 из 4"), "step 1 progress label");
  };

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await startCreate();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("обязатель"), "step1 validation on Далее");
  await page.locator('[data-tt-field="item"]').fill("Wizard QA item");
  await page.locator('[data-tt-field="item"]').press("Enter");
  await waitWizardTitle("files", "Фото и файлы");
  ok((await page.locator(".tt-wizard-progress").textContent()).includes("Шаг 2 из 4"), "step 2 progress");

  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await waitWizardTitle("recipient", "Кому нужно доставить");
  ok((await page.getByRole("button", { name: "Далее", exact: true }).count()) === 0, "recipient chooser hides Далее until confirmed");
  await ttOpenRecipientList();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("получ"), "recipient required on list without pick");

  await page.locator('[data-tt="create-recipient-back-choose"]').click();
  await page.locator('[data-tt="recipient-choose"]').waitFor({ state: "visible" });
  await ttOpenRecipientList();
  await page.locator(".tt-wizard-contact").first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("review", "Проверить и создать");

  await page.locator('[data-tt="create-edit-item"]').click();
  await waitWizardTitle("item", "Что передаём");
  await page.locator('[data-tt-field="item"]').fill("Wizard QA item edited");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("files", "Фото и файлы");
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await waitWizardTitle("recipient", "Кому нужно доставить");
  await ttWizardRecipientToReview();
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("edited"), "edit from summary returns to step");

  await page.locator('[data-tt="create-edit-comment"]').click();
  await waitWizardTitle("edit-comment", "Комментарий");
  await page.locator('[data-tt-field="comment"]').fill("Коммент QA");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitWizardTitle("review", "Проверить и создать");

  await page.locator('[data-tt="create-edit-due"]').click();
  await waitWizardTitle("edit-due", "До какого срока доставить");
  await page.locator('[data-tt-field="due"]').fill("2030-06-15T12:00");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitWizardTitle("review", "Проверить и создать");

  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await waitWizardTitle("recipient", "Кому нужно доставить");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await waitWizardTitle("files", "Фото и файлы");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await waitWizardTitle("item", "Что передаём");
  ok((await page.locator('[data-tt-field="item"]').inputValue()) === "Wizard QA item edited", "back retains item text");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("files", "Фото и файлы");

  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "wiz.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("recipient", "Кому нужно доставить");
  await ttWizardRecipientToReview();
  ok((await page.locator('[data-tt="wizard-review"]').textContent()).includes("1 файл"), "back/forward retains staged files");

  await ttExitWizardToRegistry();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.locator('[data-tt-main-cta]').first().click();
  await waitWizardTitle("item", "Что передаём");
  await page.locator('[data-tt-field="item"]').fill("New contact wizard");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-tt="recipient-choose"] [data-tt="create-new-recipient"]').click();
  await waitWizardTitle("recipient-new-name", "Имя нового получателя");
  ok((await page.locator(".tt-wizard-progress").textContent()).includes("Шаг 3 из 4"), "new name stays step 3 label");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("имя"), "new name validation");
  await page.locator('[data-tt-field="newName"]').fill("Wizard Новый");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("recipient-new-phone", "Телефон нового получателя");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("телефон"), "phone validation");
  await page.locator('[data-tt-field="newPhone"]').fill("79000000988");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitWizardTitle("review", "Проверить и создать");

  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="toast"]').textContent()).includes("создан"), "success toast after create");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('[data-tt="back-list"]').click();
  await page.locator('[data-tt="create"]').click();
  await waitWizardTitle("item", "Что передаём");
  await page.evaluate(() => {
    if (document.getElementById("af-required-reminder")) return;
    const r = document.createElement("div");
    r.id = "af-required-reminder";
    r.className = "af af-required-reminder";
    r.innerHTML =
      "<div><strong>Оцените завершённую работу · 1</strong><span>Обязательный шаг</span></div><button type='button'>Поставить оценку</button>";
    document.getElementById("app")?.append(r);
  });
  ok(await page.locator("#af-required-reminder").isHidden(), "required-review reminder hidden during create wizard");
  const nextBtn = page.locator('[data-tt="create-wizard-next"]');
  await nextBtn.waitFor({ state: "visible" });
  const box = await nextBtn.boundingBox();
  ok(box && box.height >= 48, "wizard primary button min 48px at 375");
  ok(box && box.y >= 0 && box.y + box.height <= 813, "Далее within viewport height at 375");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const contrast = await page.getByRole("button", { name: "Далее", exact: true }).evaluate((el) => {
    const s = getComputedStyle(el);
    const parse = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(s.color);
    const bg = parse(s.backgroundColor);
    const L1 = lum(fg);
    const L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  });
  ok(contrast >= 4.5, "dark wizard primary contrast");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/#exchange?role=manager`);
  await page.locator('[data-go="tan-tracker"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="create"]').isVisible(), "cold exchange entry shows create CTA");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_QA, null, 2));
