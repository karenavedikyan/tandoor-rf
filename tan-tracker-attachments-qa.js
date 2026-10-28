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
    const card = page.locator(`.tt-card-v2[data-tt-open="${id}"], .tt-card[data-tt-open="${id}"]`);
    const row = page.locator(`tr[data-tt-open="${id}"], .tt-table [data-tt-open="${id}"]`);
    if (await card.first().isVisible()) await card.first().click();
    else await row.first().click();
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
  await page.locator('[data-tt-main-cta]').first().click();
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
  await ttWaitAttThumbLoaded();
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
  await ttOpenRecipientList();
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.locator('[data-tt="recipient-selected"]').waitFor({ state: "visible" });
  await ttWizardRecipientToReview();
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="detail-attachments-disclosure"] summary').click();
  ok((await page.locator('[data-tt="detail-attachments-disclosure"] .tt-att-item').count()) >= 1, "create saved with attachment");

  const orderId = await page.evaluate(() => window.TanTrackerPrototype.orders().find((x) => x.item === "Attach QA")?.id);
  ok(!!orderId, "created order in memory");

  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  ok((await page.locator('[data-tt="attachments"]').count()) === 0, "recipient hides attachments before phone verify");
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  const recipAtt = page.locator('[data-tt="recipient-attachments-disclosure"]');
  if (await recipAtt.count()) {
    if (!(await recipAtt.evaluate((el) => el.open))) await recipAtt.locator("summary").click();
  }
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
  const attPanel = page.locator('[data-tt="detail-attachments-disclosure"]');
  if (!(await attPanel.evaluate((el) => el.open))) await attPanel.locator("summary").click();
  ok(await attPanel.evaluate((el) => el.open), "holder opens attachments disclosure before append");
  await page.locator('[data-tt="detail-attachments-disclosure"] [data-tt="attach-input"]').setInputFiles({
    name: "holder-add.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.waitForFunction(
    (id) => {
      const o = window.TanTrackerPrototype.orders().find((x) => x.id === id);
      return o && o.attachments.some((a) => String(a.name || "").includes("holder-add"));
    },
    orderId,
    { timeout: 10000 }
  );
  ok(await attPanel.evaluate((el) => el.open), "attachments disclosure stays open after holder upload rerender");
  const holderItem = page.locator('[data-tt="detail-attachments-disclosure"] .tt-att-item').filter({ hasText: "holder-add" });
  await holderItem.waitFor({ state: "visible" });
  await ttWaitAttThumbLoaded();
  const attCount = await page.evaluate((id) => window.TanTrackerPrototype.orders().find((o) => o.id === id).attachments.length, orderId);
  ok(attCount >= 2, "holder appended attachment on detail");

  await page.setViewportSize({ width: 375, height: 812 });
  ok(await page.locator('[data-tt="detail-attachments-disclosure"]').isVisible(), "attachments disclosure visible at 375px");
  ok(
    (await page.locator('[data-tt="detail-attachments-disclosure"] .tt-att-item').filter({ hasText: "holder-add" }).count()) >= 1,
    "holder-added file listed inside open attachments disclosure at 375px"
  );

  await page.locator('[data-tt="back-list"]').click();
  await open("TT-2026-001");
  const attTogglePanel = page.locator('[data-tt="detail-attachments-disclosure"]');
  ok(await attTogglePanel.evaluate((el) => !el.open), "seed order attachments closed before explicit open");
  await attTogglePanel.locator("summary").click();
  ok(await attTogglePanel.evaluate((el) => el.open), "explicit summary opens attachments");
  await page.waitForFunction(() => {
    const k = window.TanTrackerPrototype.state.detailAttDisclosureOpen;
    return k && k.orderId === "TT-2026-001" && k.actorId;
  });
  ok(true, "toggle capture records user-opened attachments for order and actor");
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('button[data-tt="detail"]').click();
  ok(await attTogglePanel.evaluate((el) => el.open), "explicit open survives detail rerender same order");
  const previewBtn = attTogglePanel.locator('[data-tt="attach-preview"]').first();
  if (await previewBtn.count()) {
    await previewBtn.click();
    await page.locator('[data-tt="attach-lightbox"]').waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator('[data-tt="attach-lightbox"]').waitFor({ state: "hidden" });
    ok(await attTogglePanel.evaluate((el) => el.open), "explicit open survives preview close");
    await page.locator('[data-tt="enter-code"]').click();
    await page.locator('button[data-tt="detail"]').click();
    ok(await attTogglePanel.evaluate((el) => el.open), "explicit open survives preview and second rerender");
  }
  await page.locator('[data-tt="back-list"]').click();
  await open("TT-2026-002");
  ok(await page.locator('[data-tt="detail-attachments-disclosure"]').evaluate((el) => !el.open), "other order attachments closed by default");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await open("TT-2026-001");
  ok((await page.locator('[data-tt="attachments"] .tt-att-item').count()) >= 2, "reload re-seeds demo attachments");
  ok((await page.evaluate(() => window.TanTrackerPrototype.orders().some((o) => o.item === "Attach QA"))) === false, "reload drops user-created order");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_ATT_QA, null, 2));
