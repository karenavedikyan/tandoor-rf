var TT_STEP_NOTIFICATIONS_QA = await (async () => {
  const checks = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ok = (v, s) => {
    if (!v) throw Error("Step notifications QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const bellCount = async () => {
    const label = await page.locator("#af-bell").getAttribute("aria-label");
    const m = label.match(/(\d+) непрочитанных/);
    return m ? Number(m[1]) : 0;
  };
  const openInboxTt = async () => {
    await page.locator("#af-bell").click();
    await page.locator("#af-inbox").waitFor({ state: "visible" });
    await page.locator('[data-af="cat-tt"]').click();
  };
  const inboxHasTitle = async (title) =>
    (await page.locator(".af-note").filter({ hasText: title }).count()) > 0;

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  const beforeBell = await bellCount();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(await inboxHasTitle("Передача направлена"), "sender inbox assign (a)");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();
  const assignItems = await page.evaluate(() => ({
    c1: (window.TanTrackerNotifications.forEmployee("c1") || []).some((i) => i.title === "Вам передают"),
    m1: (window.TanTrackerNotifications.forEmployee("m1") || []).some((i) => i.title === "Передача направлена"),
  }));
  ok(assignItems.c1 && assignItems.m1, "both sides have assign events in tracker inbox");
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=coordinator&tt_emp=c1&tt_id=TT-2026-004";
  });
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(await inboxHasTitle("Вам передают"), "recipient inbox assign (a) in bell UI");
  const preview = page.locator('[data-af="messenger-preview"]').first();
  ok(await preview.count(), "messenger preview details present");
  await preview.locator("summary").click();
  const pre = await preview.locator("pre").textContent();
  ok(pre.includes("Тан-трекер · TT-2026-004"), "messenger preview header line");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();
  ok((await bellCount()) > beforeBell, "bell count increased after assign events");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-018`);
  await page.reload();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  ok((await page.locator('[data-tt="recipient-progress"]').textContent()).includes("Шаг 1 из 3"), "progress step 1");
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  ok((await page.locator('[data-tt="recipient-progress"]').textContent()).includes("Шаг 2 из 3"), "progress step 2");
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  ok((await page.locator('[data-tt="recipient-progress"]').textContent()).includes("Шаг 3 из 3"), "progress step 3");
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  ok(await page.locator('[data-tt="recipient-whats-next"]').isVisible(), "whats-next on code step");
  const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(await inboxHasTitle("Получатель получил код"), "holder code issued (c)");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  ok((await page.locator("#tt-code-demo-help").textContent()).includes("Telegram или MAX"), "external code-entry hint");
  await page.locator('[data-tt="code-input"]').fill(code);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(!(await inboxHasTitle("Получатель получил код")), "code event gone after confirm");
  ok(await inboxHasTitle("Получение подтверждено"), "former holder confirm (d)");
  const relayState = await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-018");
    const ev = (window.TanTrackerNotifications.forEmployee("m3") || []).find((i) => i.key.includes(":confirm:sender"));
    return {
      intermediate: o.holderId === "ext_01" && o.finalRecipientId === "ext_02" && o.status !== "completed",
      formerText: ev?.text || "",
    };
  });
  ok(relayState.intermediate, "018 intermediate custody after confirm");
  ok(relayState.formerText.includes("Сергей"), "former holder message names recipient");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const codeFin = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(codeFin);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(!(await inboxHasTitle("Передача завершена")), "no completed inbox event until explicit close");
  ok(await inboxHasTitle("Получение подтверждено"), "former holder event after final delivery");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await ttOpenOtherActions();
  await page.locator('[data-tt="cancel-pending"]').click();
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  ok(
    await page.evaluate(() =>
      (window.TanTrackerNotifications.forEmployee("c1") || []).some((i) => i.title === "Передача отменена")
    ),
    "cancel event (b) for previous pending"
  );
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=coordinator&tt_emp=c1";
  });
  await page.evaluate(() => document.dispatchEvent(new Event("assistant:paint")));
  await openInboxTt();
  ok(await inboxHasTitle("Передача отменена"), "cancel event visible in recipient inbox");
  await page.locator('#af-inbox [data-af="close-inbox"]').click();

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-014`);
  await page.reload();
  ok(await page.locator('[data-tt="detail-task-awaiting"]').isVisible(), "staff pending awaiting card (3)");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.locator("#af-bell").click();
  await page.locator('[data-af="cat-tt"]').click();
  const inboxOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  ok(!inboxOverflow, "375 inbox no horizontal overflow");
  const messengerRow = page.locator('[data-af="messenger-preview"]').first();
  if (await messengerRow.count()) {
    const contrast = await messengerRow.locator("summary").evaluate((el) => window.ttQaContrastRatioOnElement(el));
    ok(contrast >= 4.5, `dark messenger preview contrast (${contrast.toFixed(2)})`);
  } else {
    ok(true, "dark messenger preview contrast skipped (no preview row in inbox)");
  }
  await page.locator('#af-inbox [data-af="close-inbox"]').click();
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m3&tt_id=TT-2026-018`);
  await page.reload();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  const recipOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  ok(!recipOverflow, "375 recipient no horizontal overflow");
  const progContrast = await page.locator('[data-tt="recipient-progress"]').evaluate((el) =>
    window.ttQaContrastRatioOnElement(el)
  );
  ok(progContrast >= 4.5, `dark recipient progress contrast (${progContrast.toFixed(2)})`);
  ok(errors.length === 0, "no page errors");

  return { passed: checks.length, checks, pageErrors: errors };
})();
console.log(JSON.stringify(TT_STEP_NOTIFICATIONS_QA, null, 2));
