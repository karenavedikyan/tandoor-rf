var TT_WIZ_LAYOUT_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard layout QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  const assertContactCards = async (label) => {
    const report = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".tt-wizard-contact")];
      return cards.map((card, i) => {
        const phone = card.querySelector(".tt-wizard-contact-phone");
        if (!phone) return { ok: false, reason: "no phone" };
        const cr = card.getBoundingClientRect();
        const pr = phone.getBoundingClientRect();
        const next = cards[i + 1];
        const nr = next?.getBoundingClientRect();
        const phoneInside = pr.top >= cr.top - 1 && pr.bottom <= cr.bottom + 1 && pr.left >= cr.left - 1 && pr.right <= cr.right + 1;
        const tallEnough = cr.height >= 68;
        const noOverlap = !nr || pr.bottom <= nr.top + 1;
        return { phoneInside, tallEnough, noOverlap, h: cr.height };
      });
    });
    ok(report.length > 0, `${label}: contact list renders`);
    ok(report.every((r) => r.phoneInside), `${label}: phone inside own card`);
    ok(report.every((r) => r.noOverlap), `${label}: cards do not overlap vertically`);
    ok(report.every((r) => r.tallEnough), `${label}: cards tall enough for name+phone`);
  };

  const assertStickyClearance = async () => {
    await page.evaluate(() => {
      const list = document.querySelector(".tt-wizard-contact-list");
      if (list) list.scrollTop = list.scrollHeight;
    });
    const last = page.locator(".tt-wizard-contact").last();
    await last.scrollIntoViewIfNeeded();
    const hit = await page.evaluate(() => {
      const el = document.querySelector(".tt-wizard-contact:last-of-type");
      const bar = document.querySelector(".tt-wizard-actions");
      if (!el || !bar) return { ok: false };
      const er = el.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const y = Math.min(er.bottom - 8, br.top - 12);
      const x = er.left + Math.min(40, er.width / 2);
      const topEl = document.elementFromPoint(x, y);
      return { ok: !!(topEl && el.contains(topEl)), pad: parseFloat(getComputedStyle(document.querySelector(".tt-wizard-body")).paddingBottom) };
    });
    ok(hit.ok, "375px last contact row hit target not occluded by sticky actions");
    ok(hit.pad >= 100, "375px wizard body reserves space above sticky actions");
    await last.click();
    ok((await last.getAttribute("aria-pressed")) === "true", "375px last contact row clickable after scroll");
  };

  const assertReviewGrid = async () => {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".tt-wizard-summary-row")].map((row) => {
        const val = row.querySelector(".tt-wizard-summary-value");
        const edit = row.querySelector(".tt-wizard-summary-edit");
        if (!val || !edit) return { ok: false };
        const vr = val.getBoundingClientRect();
        const er = edit.getBoundingClientRect();
        return {
          editRightOfValue: er.left >= vr.right - 8 || er.left > vr.left + vr.width * 0.35,
          sameRow: Math.abs(vr.top - er.top) < 40,
          editMinH: er.height >= 44,
        };
      })
    );
    ok(rows.length >= 5, "review summary rows present");
    ok(rows.every((r) => r.editRightOfValue && r.sameRow), "review edit buttons align right on value row");
    ok(rows.every((r) => r.editMinH), "review edit buttons min 44px tall");
    const order = await page.locator(".tt-wizard-summary dt").allTextContents();
    ok(order.indexOf("Кому доставить") < order.indexOf("Фото и файлы"), "delivery route before optional files on review");
  };

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Layout QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-att-file-btn").count()) >= 1, "step2 uses Russian file button not native chrome");
  ok((await page.locator(".tt-att-input-sr").count()) >= 1, "step2 keeps accessible hidden file input");
  const btnBox = await page.locator(".tt-att-file-btn").first().boundingBox();
  ok(btnBox && btnBox.height >= 48, "step2 file button at least 48px tall");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await assertContactCards("375px step3");
  await assertStickyClearance();

  await page.setViewportSize({ width: 1440, height: 900 });
  await assertContactCards("desktop step3");

  await page.locator(".tt-wizard-contact").first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await assertReviewGrid();

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_LAYOUT_QA, null, 2));
