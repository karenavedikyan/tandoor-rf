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

  const assertReviewHierarchy = async () => {
    const report = await page.evaluate(() => {
      const review = document.querySelector('[data-tt="wizard-review"]');
      const item = document.querySelector(".tt-wizard-review-item-title");
      const route = document.querySelector(".tt-wizard-review-route-card");
      const details = document.querySelector(".tt-wizard-review-details");
      const links = [...document.querySelectorAll(".tt-wizard-review-link")];
      if (!review || !item || !route || !details || !links.length) return { ok: false };
      const itemTop = item.getBoundingClientRect().top;
      const detailsTop = details.getBoundingClientRect().top;
      const linkHeights = links.map((l) => l.getBoundingClientRect().height);
      const textLinks = links.every((l) => l.classList.contains("tt-wizard-review-link") && !l.classList.contains("tt-wizard-btn"));
      return {
        ok: itemTop < detailsTop && route.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
        linkHeightsOk: linkHeights.every((h) => h >= 44),
        textLinks,
      };
    });
    ok(report.ok, "review item and route precede calmer details block");
    ok(report.linkHeightsOk, "review text-link edits min 44px tall");
    ok(report.textLinks, "review edits use text-link styling");
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
  await assertReviewHierarchy();

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_LAYOUT_QA, null, 2));
