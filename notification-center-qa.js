var NOTIFICATION_CENTER_QA = await (async () => {
  const checks = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ok = (v, s) => {
    if (!v) throw Error("Notification center QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const qaVisitor = "nc-qa-" + Date.now();
  await page.addInitScript((id) => {
    window.__NOTIFICATION_DEMO_VISITOR__ = id;
  }, qaVisitor);
  const bell = () => page.locator("#af-bell").click();
  const closeInbox = () => page.locator('#af-inbox [data-af="close-inbox"]').click();
  const closeProfile = () => page.locator('#af-profile-dialog [data-af="profile-close"]').click();
  const demoNoteLine = () =>
    page.locator(".af-note").filter({ hasText: "срок передачи сегодня" }).locator(".af-muted").last();

  await page.goto(`${base}/#handover?as_role=manager`);
  await page.evaluate(async () => {
    await window.NotificationDemoStore?.resetRemote?.();
    await window.NotificationDemoStore?.hydrate?.();
  });

  ok(await page.locator("#af-bell").count() === 1, "single header bell");
  ok(await page.evaluate(() => window.NotificationDemoStore.isApiEnabled()), "preview backend API enabled on localhost");
  await bell();
  ok((await page.locator("#af-inbox h2").textContent()).includes("Центр уведомлений"), "inbox title unified center");
  await page.locator('[data-af="cat-system"]').click();
  ok((await page.locator(".af-note").count()) >= 1, "manager has synthetic system category item");
  await page.locator('[data-af="cat-all"]').click();

  await page.locator('[data-af="read-all"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  ok((await page.locator("#af-save-status").getAttribute("data-state")) === "saved", "read-all persisted to backend before reload");
  ok((await page.locator("#af-bell").getAttribute("aria-label")).includes("0 непрочитанных"), "read all clears unread count");
  await page.locator('[data-af="unread"]').click();
  ok((await page.locator(".af-note").count()) === 0, "unread filter empty after read all");
  ok((await page.locator("#af-inbox .af-empty").textContent()).includes("Непрочитанных"), "unread empty state copy");
  await closeInbox();
  await page.reload();
  await bell();
  await page.locator('[data-af="unread"]').click();
  ok((await page.locator(".af-note").count()) === 0, "unread empty persists after reload");
  await closeInbox();

  await page.locator("#af-profile-btn").click();
  await page.locator("#af-profile-dialog").waitFor({ state: "visible" });
  await page.locator('[data-af="connect-telegram"]').click();
  await page.locator('[data-af="connect-max"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  await closeProfile();

  await bell();
  await page.locator('[data-af="all"]').click();
  await page.locator('[data-af="cat-tt"]').click();
  ok((await demoNoteLine().textContent()).includes("ошибка доставки"), "demo TT item shows failed delivery before retry");
  await closeInbox();

  await page.locator("#af-profile-btn").click();
  await page.locator('[data-af="delivery-retry"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  await page.locator("#af-profile-dialog").waitFor({ state: "hidden" });

  await bell();
  await page.locator('[data-af="all"]').click();
  await page.locator('[data-af="cat-tt"]').click();
  const afterRetry = await demoNoteLine().textContent();
  ok(afterRetry.includes("демо-отправка"), "retry clears failed delivery status on same event");
  ok(!afterRetry.includes("ошибка доставки"), "retry removes error wording from center line");
  await closeInbox();

  await bell();
  await page.locator('[data-af="cat-all"]').click();
  await page.locator('[data-af="all"]').click();
  const noteCount = await page.locator(".af-note").count();
  ok(noteCount >= 3, "manager inbox has TT, assignment and system items");
  await closeInbox();
  await page.locator("#af-profile-btn").click();
  await page.locator('[data-af="disconnect-telegram"]').click();
  await page.locator('[data-af="disconnect-max"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  await closeProfile();
  await bell();
  await page.locator('[data-af="cat-all"]').click();
  await page.locator('[data-af="all"]').click();
  ok((await page.locator(".af-note").count()) === noteCount, "disconnect channels keeps LK history count");
  ok((await page.locator(".af-note").first().locator(".af-muted").last().textContent()).includes("Только в ЛК"), "disconnect shows LK-only delivery line");
  await page.locator(".af-note").filter({ hasText: "Назначение согласовано" }).getByRole("button", { name: "Открыть назначение", exact: true }).first().click();
  await page.locator("#as-content .as-panel, #as-content .as-detail").first().waitFor({ state: "visible", timeout: 8000 });
  ok((await page.evaluate(() => location.hash)).includes("handover"), "assignment notification opens handover module");
  await bell();
  await page.locator('[data-af="all"]').click();
  await page.locator('[data-af="cat-tt"]').click();
  await page.getByRole("button", { name: "Открыть трек", exact: true }).first().click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.evaluate(() => location.hash)).includes("tan-tracker"), "TT notification opens tracker");
  if (await page.locator("#af-inbox").count()) await closeInbox();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
  await bell();
  const box = await page.locator("#af-inbox").evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, w: innerWidth };
  });
  ok(box.left >= 8 && box.right <= box.w - 8, "375px dark inbox fits viewport");
  await page.keyboard.press("Escape");
  ok(await page.locator("#af-inbox").count() === 0, "Escape closes inbox on mobile");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
  await bell();
  ok(await page.locator("#af-inbox").isVisible(), "desktop light inbox after resize up");
  await closeInbox();
  await page.setViewportSize({ width: 375, height: 812 });
  await bell();
  ok(await page.locator("#af-inbox").isVisible(), "mobile inbox after resize down");
  await closeInbox();

  await page.unroute("http://127.0.0.1:34113/**").catch(() => {});
  await page.route("http://127.0.0.1:34113/**", (route) => route.abort("failed"));
  await page.locator("#af-profile-btn").click();
  await page.locator('#af-profile-dialog [data-af="pref"][data-id="tt"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  const failState = await page.locator("#af-save-status").getAttribute("data-state");
  ok(failState === "failed", "backend failure surfaces failed save state not success");
  await page.locator('#af-profile-dialog [data-af="profile-close"]').click();
  await page.unroute("http://127.0.0.1:34113/**");

  await page.goto(`${base}/#exchange?role=manager`);
  await page.waitForTimeout(300);
  ok(errors.length === 0, "no page errors from start through flows");

  return { passed: checks.length, checks, pageErrors: errors };
})();
console.log(JSON.stringify(NOTIFICATION_CENTER_QA, null, 2));
