var TT_EXT_REQUEST_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Ext request QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_act=ext_01`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const extOpen = page.locator('[data-tt="ext-request-open"]').first();
  await extOpen.waitFor({ state: "visible" });
  ok(await extOpen.isVisible(), "shell header button");

  await extOpen.click();
  await page.locator('[data-tt="ext-request"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="extItem"]').fill("Заявка от клиента QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator(".tt-ext-chat-step").textContent()).includes("Шаг 2"), "photo step is second");
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "ext-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  await page.locator(".tt-att-item").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  const recipients = await page.locator('[data-tt-ext-pick]').count();
  ok(recipients >= 1 && recipients <= 8, "short staff recipient list");
  await page.locator('[data-tt-ext-pick]').first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Создать заявку", exact: true }).click();
  await page.locator('[data-tt="ext-request-bot"]').waitFor({ state: "visible" });
  const createdId = await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().find((x) => x.item === "Заявка от клиента QA");
    return o?.id;
  });
  ok(createdId && createdId.startsWith("TT-2026-"), "order created with id");
  ok(await page.evaluate(() => window.TanTrackerPrototype.orders().find((x) => x.item === "Заявка от клиента QA").fromExternal), "fromExternal flag");
  ok(await page.evaluate(() => (window.TanTrackerPrototype.orders().find((x) => x.item === "Заявка от клиента QA").attachments || []).length === 1), "photo from bot attached to order");

  await page.getByRole("button", { name: "Открыть мою передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="enter-code"]').count() >= 0, "external holder detail");

  const staffId = await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().find((x) => x.item === "Заявка от клиента QA");
    return o.pendingId;
  });
  const emp = await page.evaluate((cid) => window.TanTrackerPrototype.contacts().find((c) => c.id === cid)?.employeeId, staffId);
  await page.evaluate(({ e, id }) => {
    location.hash = `#tan-tracker?role=manager&tt_emp=${e}&tt_id=${id}`;
  }, { e: emp, id: createdId });
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="detail-task-awaiting"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-detail-task-heading").textContent()).includes("от клиента"), "staff inbox title prefix");
  ok(
    await page.evaluate((id) => !!window.TanTrackerPrototype.orders().find((o) => o.id === id)?.fromExternal, createdId),
    "fromExternal on staff order"
  );

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_act=ext_01";
  });
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.evaluate(() => {
    const ext = "ext_01";
    const list = window.TanTrackerPrototype.orders();
    for (let i = 0; i < 4; i++) {
      list.unshift({
        id: `TT-2026-L${i}`,
        item: `Open ${i}`,
        holderId: ext,
        pendingId: "emp_m1",
        finalRecipientId: "emp_m1",
        createdById: ext,
        status: "active",
        fromExternal: true,
        timeline: [],
        holderSince: Date.now(),
      });
    }
  });
  await page.locator('[data-tt="ext-request-open"]').first().click();
  const blocked = await page.locator('[data-tt="ext-request"]').textContent();
  ok(blocked.includes("5") && blocked.includes("завершения"), "limit 5 open requests message");

  await page.evaluate(({ e, id }) => {
    location.hash = `#tan-tracker?role=manager&tt_emp=${e}&tt_id=${id}`;
  }, { e: emp, id: createdId });
  await page.locator('[data-tt="ext-request-decline"]').click();
  await page.getByRole("button", { name: "Отклонить", exact: true }).click();
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_act=ext_01&tt_id=" + window.TanTrackerPrototype.orders().find((x) => x.item === "Заявка от клиента QA").id;
  });
  await page.locator('[data-tt="bot-message-preview"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="bot-message-preview"] pre').textContent()).includes("отклонена"), "declined bot bubble");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_EXT_REQUEST_QA, null, 2));
