var TT_INGEST_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker attach ingest QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const goFilesStep = async () => {
    await page.locator('[data-tt="create"]').click();
    await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
    await page.locator('[data-tt-field="item"]').fill("Ingest race QA");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  };

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.evaluate(() => window.TanTrackerAttachments.setRasterDelayForTests(700));
  await goFilesStep();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "slow-race.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="create-skip-files"][disabled]').waitFor({ state: "attached", timeout: 3000 });
  ok(await page.locator('[data-tt="attach-busy"]').isVisible(), "busy hint while raster pending");
  ok(await page.locator('[data-tt="create-skip-files"]').isDisabled(), "Пропустить disabled while files processing");
  await page.locator('[data-tt="create-wizard-back"]').click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="back-list"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.waitForTimeout(900);
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.state.attachStaging.length)) === 0,
    "cancel during delayed ingest leaves empty staging"
  );

  await page.locator('[data-tt="create"]').click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Fresh draft");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  ok(
    (await page.locator('[data-tt="attach-list"] .tt-att-item').count()) === 0,
    "new draft after cancel has no orphan staged files"
  );
  await page.evaluate(() => window.TanTrackerAttachments.setRasterDelayForTests(0));

  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "revoke-me.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  const stagedId = await page.evaluate(() => window.TanTrackerPrototype.state.attachStaging[0]?.id);
  ok(!!stagedId, "file staged before cancel");
  await page.locator('[data-tt="create-wizard-back"]').click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="back-list"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.evaluate(() => window.TanTrackerPrototype.state.attachStaging.length)) === 0, "cancel revokes staging list");

  await goFilesStep();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "handoff-keep.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  const orderId = await page.evaluate(() => window.TanTrackerPrototype.state.orderId);
  ok(
    (await page.evaluate((id) => window.TanTrackerPrototype.orders().find((o) => o.id === id).attachments.length, orderId)) >= 1,
    "order keeps attachment after create"
  );
  const nw = await page.locator(".tt-att-thumb img").first().evaluate((img) => img.naturalWidth);
  ok(nw > 0, "attachment image still loads after create (URL retained on order)");

  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  const nwR = await page.locator(".tt-att-thumb img").first().evaluate((img) => img.naturalWidth);
  ok(nwR > 0, "recipient still sees attachment image after handoff prep");

  await page.evaluate(() => window.TanTrackerAttachments.setRasterDelayForTests(0));

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_INGEST_QA, null, 2));
