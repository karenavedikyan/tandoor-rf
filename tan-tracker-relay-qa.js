var TT_RELAY_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker relay QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Relay QA цепочка");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "relay.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt="create-edit-relay"]').click();
  await page.locator('[data-create-phase="relay-pick"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.locator('[data-tt="create-edit-due"]').click();
  await page.locator('[data-tt-field="due"]').fill("2031-06-15T18:00");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  const orderId = await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().slice(-1)[0];
    return o.id;
  });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Сергей"), "create keeps final recipient on detail");

  await page.evaluate((id) => {
    location.hash = `#tan-tracker?role=coordinator&tt_id=${id}`;
  }, orderId);
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator("#af-bell").click();
  await page.locator("#af-inbox").waitFor({ state: "visible" });
  ok((await page.locator("#af-inbox").textContent()).includes("Ожидает вашего получения"), "coordinator bell shows pending receipt notice");
  await page.locator('[data-af="close-inbox"]').click();

  await page.evaluate((id) => {
    location.hash = `#tan-tracker?role=manager&tt_id=${id}`;
  }, orderId);
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code1 = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(code1);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Савельева"), "code handoff to relay employee");

  await page.evaluate((id) => {
    location.hash = `#tan-tracker?role=coordinator&tt_id=${id}`;
  }, orderId);
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Смотреть как текущий держатель (демо)", exact: true }).click();
  const detailRelay = await page.locator('[data-tt="detail"]').textContent();
  ok(detailRelay.includes("Сергей") && detailRelay.includes("79000000001"), "relay holder sees final name and phone");
  ok(detailRelay.includes("2031") || detailRelay.includes("15.06"), "relay holder sees delivery deadline");
  ok(await page.locator('[data-tt="relay-reminder"]').count() === 1, "relay obligation visible for holder");
  ok((await page.getByRole("button", { name: "Завершить передачу", exact: true }).count()) === 0, "intermediate cannot complete");

  await page.locator('[data-tt="transfer-final"]').click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Ожидает"), "transfer-final sets pending to final recipient");
  ok(await page.locator('[data-tt="relay-reminder"]').count() === 1, "obligation stays while pending final receipt");
  ok((await page.getByRole("button", { name: "Передать другому человеку", exact: true }).count()) === 0, "no second transfer while pending");
  ok((await page.getByRole("button", { name: "Передать конечному получателю", exact: true }).count()) === 0, "no duplicate transfer-final while pending");

  await page.locator("#af-bell").click();
  await page.locator("#af-inbox").waitFor({ state: "visible" });
  const inboxHold = await page.locator("#af-inbox").textContent();
  ok(inboxHold.includes("передать"), "bell still shows holder relay notice while pending");
  await page.locator('[data-af="open-note"]').first().click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator("h2").first().textContent()).includes(orderId), "open track navigates to tan-tracker detail not assignments");
  await page.locator("#af-bell").click();
  await page.locator('[data-af="close-inbox"]').click();

  await page.locator('[data-tt="tab-qr"]').click();
  await page.locator('[data-tt="scan-qr-demo"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить получение", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Завершена"), "final QR receipt completes track");
  ok(await page.locator('[data-tt="relay-reminder"]').count() === 0, "relay reminder cleared after delivery");

  const attCount = await page.evaluate(
    (id) => window.TanTrackerAttachments.listForOrder(window.TanTrackerPrototype.orders().find((o) => o.id === id)).length,
    orderId
  );
  ok(attCount >= 1, "attachment retained through relay chain");
  const tlLen = await page.evaluate(
    (id) => window.TanTrackerPrototype.orders().find((o) => o.id === id).timeline.length,
    orderId
  );
  ok(tlLen >= 3, "timeline keeps handoff history");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=${orderId}`);
  await page.reload();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Завершена"), "historical participant still reads completed order");
  ok((await page.getByRole("button", { name: "Передать другому человеку", exact: true }).count()) === 0, "historical view not editable after complete");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-008`);
  await page.reload();
  ok((await page.locator("#tt-content").textContent()).includes("Нет доступа"), "forbidden order blocks attachments and detail");
  ok((await page.locator(".tt-att-item").count()) === 0, "forbidden hash hides attachments");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=coordinator&tt_id=${orderId}`);
  await page.reload();
  ok(await page.locator('[data-tt="detail"]').isVisible(), "375px detail readable for historical relay order");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  ok(await page.locator('[data-tt="detail"]').isVisible(), "dark theme relay detail visible");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_RELAY_QA, null, 2));
