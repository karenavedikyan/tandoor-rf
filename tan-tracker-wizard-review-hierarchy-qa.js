var TT_WIZ_REVIEW_HIER_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard review hierarchy QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const waitReview = async () => {
    await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  };

  const assertHierarchy = async (label) => {
    const h = await page.evaluate(() => {
      const item = document.querySelector(".tt-wizard-review-item-title");
      const finalName = document.querySelector(".tt-wizard-review-route-block:not(.tt-wizard-review-handoff) .tt-wizard-review-person-name");
      const detailVal = document.querySelector(".tt-wizard-review-detail-value");
      const edit = document.querySelector(".tt-wizard-review-link");
      const primary = document.querySelector('[data-tt="create-wizard-submit"]');
      if (!item || !finalName || !detailVal || !edit || !primary) return { ok: false };
      const fs = (el) => parseFloat(getComputedStyle(el).fontSize);
      const fw = (el) => parseFloat(getComputedStyle(el).fontWeight);
      const primaryBg = getComputedStyle(primary).backgroundColor;
      const editBorder = getComputedStyle(edit).borderWidth;
      return {
        ok: fs(item) > fs(finalName) && fs(finalName) >= fs(detailVal) && fw(item) >= 700,
        editTextLike:
          edit.classList.contains("tt-wizard-review-link") &&
          !edit.classList.contains("tt-wizard-btn") &&
          (editBorder === "0px" || editBorder === "0"),
        primaryFilled: primary.classList.contains("tt-primary") && primaryBg !== "rgba(0, 0, 0, 0)",
        editMinH: edit.getBoundingClientRect().height >= 44,
      };
    });
    ok(h.ok, `${label}: item title visually dominates route and details`);
    ok(h.editTextLike, `${label}: review edit control is text-style`);
    ok(h.primaryFilled, `${label}: only submit uses filled primary styling`);
    ok(h.editMinH, `${label}: review edit min 44px hit area`);
  };

  const assertStickyClearance = async () => {
    await page.locator('[data-tt="review-handoff"]').scrollIntoViewIfNeeded();
    const hit = await page.evaluate(() => {
      const handoff = document.querySelector('[data-tt="review-handoff"]');
      const link = handoff?.querySelector(".tt-wizard-review-link");
      const bar = document.querySelector(".tt-wizard-actions");
      if (!link || !bar) return { ok: false };
      const lr = link.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const x = lr.left + lr.width / 2;
      const y = lr.top + lr.height / 2;
      if (y >= br.top - 4) return { ok: false, reason: "link under sticky bar" };
      const topEl = document.elementFromPoint(x, y);
      return { ok: !!(topEl && (link.contains(topEl) || topEl === link)) };
    });
    ok(hit.ok, "375px review handoff link not permanently covered by sticky footer");
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Review hierarchy QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "review-hier.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей Приёмка" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();

  ok(
    await page.locator('[data-tt="demo-settings"]').evaluate((el) => !el.open),
    "review demo settings compact closed by default"
  );

  ok((await page.locator(".tt-wizard-review-route-card").count()) === 1, "route grouped card present");
  ok((await page.locator(".tt-wizard-review-handoff-mode").textContent()).includes("Напрямую"), "direct mode avoids duplicate large handoff name");
  ok((await page.locator(".tt-wizard-review-route-block .tt-wizard-review-person-name").first().textContent()).includes("Сергей"), "final name on route card");

  await page.setViewportSize({ width: 1440, height: 900 });
  await assertHierarchy("1440 light");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await assertHierarchy("1440 dark");

  await page.setViewportSize({ width: 375, height: 812 });
  await assertHierarchy("375 dark");
  await assertStickyClearance();
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  }));
  ok(overflow.doc, "375px review no horizontal scroll");

  await page.locator('[data-tt="create-edit-relay"]').click();
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();
  ok((await page.locator(".tt-wizard-review-handoff .tt-wizard-review-person-name").textContent()).includes("Наталья"), "relay shows intermediary name");

  await page.locator('[data-tt="create-edit-due"]').click();
  await page.locator('[data-tt-field="due"]').fill("2032-03-20T14:30");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();
  ok((await page.locator(".tt-wizard-review-due--set .tt-wizard-review-due-value").textContent()).includes("2032"), "due prominent when set");

  await page.locator('[data-tt="create-edit-comment"]').click();
  await page.locator('[data-tt-field="comment"]').fill("Коммент иерархии");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await waitReview();
  const reviewText = await page.locator('[data-tt="wizard-review"]').textContent();
  ok(reviewText.includes("1 файл") && reviewText.includes("Коммент иерархии") && reviewText.includes("2032"), "file deadline comment retained");

  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Review hierarchy QA"), "relay create succeeds");

  await page.locator('[data-tt="back-list"]').click();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Review direct only");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Ольга" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();
  ok(
    await page.locator('[data-tt="demo-settings"]').evaluate((el) => !el.open),
    "review demo settings still closed before second create"
  );
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Review direct only"), "direct create succeeds");
  ok(
    await page.locator('[data-tt="demo-settings"]').evaluate((el) => !el.open),
    "detail demo settings compact closed by default"
  );

  await page.locator('[data-tt="back-list"]').click();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Review new recipient split");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.getByRole("button", { name: "Добавить нового получателя", exact: true }).click();
  await page.locator('[data-tt-field="newName"]').fill("Иерархия Новый");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt-field="newPhone"]').fill("79000000977");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitReview();
  const newRecipientDom = await page.evaluate(() => {
    const block = document.querySelector(".tt-wizard-review-route-block:not(.tt-wizard-review-handoff)");
    const nameEl = block?.querySelector(".tt-wizard-review-person-name");
    const phoneEl = block?.querySelector(".tt-wizard-review-person-phone");
    if (!nameEl || !phoneEl) return { ok: false };
    const name = nameEl.textContent || "";
    const phone = phoneEl.textContent || "";
    const nameFs = parseFloat(getComputedStyle(nameEl).fontSize);
    const phoneFs = parseFloat(getComputedStyle(phoneEl).fontSize);
    return {
      ok: nameFs > phoneFs && !/\d/.test(name) && /09-77|977|900/.test(phone),
      name,
      phone,
    };
  });
  ok(newRecipientDom.ok, "new recipient review splits large name without digits and smaller phone line");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_REVIEW_HIER_QA, null, 2));
