var TT_ATT_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker attachments QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const open = async (id) => {
    await page.locator(`.tt-table [data-tt-open="${id}"]`).click();
    await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  };

  await page.goto(`${base}/#exchange?role=manager`);
  ok((await page.locator('[data-go="tan-tracker"]').count()) === 1, "cold exchange nav has tan-tracker");
  await page.locator('[data-go="tan-tracker"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await open("TT-2026-001");
  ok((await page.locator('[data-tt="attachments"] .tt-att-item').count()) >= 2, "seeded order shows demo attachments");
  ok((await page.locator('[data-tt="attachments"] [data-tt="attach-remove"]').count()) === 0, "persisted demo attachments hide remove");
  ok((await page.locator(".tt-att-doc").first().textContent()).match(/^(PDF|TXT|PNG|JPG|DOC|XLS|FILE)/), "short doc label not raw mime");

  await page.locator('[data-tt="back-list"]').click();
  await page.locator('[data-tt="create"]').click();
  await page.locator('[data-tt="create-wizard"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Attach QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="attach-input"]').setInputFiles([
    { name: "qa-photo.png", mimeType: "image/png", buffer: Buffer.from(png1x1, "base64") },
    { name: "qa-note.txt", mimeType: "text/plain", buffer: Buffer.from("demo attach") },
  ]);
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="attach-list"] .tt-att-item').count()) === 2, "create stages multiple files");
  const nw = await page.locator(".tt-att-thumb img").first().evaluate((img) => img.naturalWidth);
  ok(nw > 0, "thumbnail image loads with naturalWidth>0");
  await page.locator(".tt-att-item", { hasText: "qa-note.txt" }).locator('[data-tt="attach-remove"]').click();
  ok((await page.locator('[data-tt="attach-list"] .tt-att-item').count()) === 1, "remove staged file before save");
  ok((await page.locator(".tt-att-thumb img").count()) === 1, "staged png remains for preview");

  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "bad.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html></html>"),
  });
  ok((await page.locator('[data-tt="attachments"] .tt-error').textContent()).includes("запрещ"), "invalid html type rejected");

  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="attachments"] .tt-att-item').count()) >= 1, "create saved with attachment");

  const orderId = await page.evaluate(() => window.TanTrackerPrototype.orders().find((x) => x.item === "Attach QA")?.id);
  ok(!!orderId, "created order in memory");

  await page.locator('[data-tt="open-recipient"]').click();
  ok((await page.locator('[data-tt="attachments"]').count()) === 0, "recipient hides attachments before phone verify");
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  ok((await page.locator('[data-tt="attachments"] .tt-att-item').count()) >= 1, "recipient sees attachments after verify");

  await page.locator('.tt-att-thumb[data-tt="attach-preview"]').first().click();
  await page.locator('[data-tt="attach-lightbox"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="attach-lightbox-img"]').isVisible(), "preview lightbox opens");
  await page.keyboard.press("Escape");
  await page.locator('[data-tt="attach-lightbox"]').waitFor({ state: "hidden" });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-tt="attach-download"]').first().click(),
  ]);
  ok((await download.suggestedFilename()).length > 0, "download event fires");
  const dlStream = await download.createReadStream();
  const dlChunks = [];
  for await (const chunk of dlStream) dlChunks.push(chunk);
  ok(Buffer.concat(dlChunks).length > 0, "download has nonzero bytes");

  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "holder-add.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attachments"] .tt-att-item').filter({ hasText: "holder-add" }).waitFor({ state: "visible" });
  const attCount = await page.evaluate((id) => window.TanTrackerPrototype.orders().find((o) => o.id === id).attachments.length, orderId);
  ok(attCount >= 2, "holder appended attachment on detail");

  await page.setViewportSize({ width: 375, height: 812 });
  ok(await page.locator('[data-tt="attachments"]').isVisible(), "attachments block visible at 375px");

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await open("TT-2026-001");
  ok((await page.locator('[data-tt="attachments"] .tt-att-item').count()) >= 2, "reload re-seeds demo attachments");
  ok((await page.evaluate(() => window.TanTrackerPrototype.orders().some((o) => o.item === "Attach QA"))) === false, "reload drops user-created order");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_ATT_QA, null, 2));
