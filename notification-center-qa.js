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
  ok((await page.evaluate(() => window.NotificationDemoStore.getSaveStatus())) === "saved", "read-all persisted to backend before reload");
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
  const ttPref = page.locator('#af-profile-dialog [data-af="pref"][data-id="tt"]');
  const ttStart = await ttPref.isChecked();
  const putWait = page.waitForResponse(
    (r) => r.url().includes("demo-notification-state") && r.request().method() === "PUT" && r.ok()
  );
  await ttPref.click();
  ok((await page.evaluate(() => window.NotificationDemoStore.getSaveStatus())) === "saving", "pref toggle saving status immediate");
  await putWait;
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  ok((await page.locator("#af-profile-store-status").textContent()).includes("сохранены"), "profile footer shows saved after PUT");
  ok((await page.locator("#af-save-status").count()) === 0, "header quiet while saved");
  await closeProfile();
  await page.reload();
  await page.locator("#af-profile-btn").click();
  ok((await ttPref.isChecked()) === !ttStart, "pref persists after reload without flush");
  const putBack = page.waitForResponse(
    (r) => r.url().includes("demo-notification-state") && r.request().method() === "PUT" && r.ok()
  );
  await ttPref.click();
  ok((await page.evaluate(() => window.NotificationDemoStore.getSaveStatus())) === "saving", "second pref toggle saving immediate");
  await putBack;
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  await closeProfile();
  await page.reload();
  await page.locator("#af-profile-btn").click();
  ok(await ttPref.isChecked() === ttStart, "pref restored after second reload without flush");
  await closeProfile();

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

  await page.unroute("http://127.0.0.1:34113/v1/demo-notification-state").catch(() => {});
  await page.locator("#af-profile-btn").click();
  await page.locator("#af-profile-dialog").waitFor({ state: "visible" });
  let releasePut1;
  let releasePut2;
  const gatePut1 = new Promise((r) => {
    releasePut1 = r;
  });
  const gatePut2 = new Promise((r) => {
    releasePut2 = r;
  });
  let gatedPutIndex = 0;
  await page.route("http://127.0.0.1:34113/v1/demo-notification-state", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const i = gatedPutIndex++;
    if (i === 0) {
      await gatePut1;
      return route.continue();
    }
    if (i === 1) {
      await gatePut2;
      return route.continue();
    }
    return route.continue();
  });
  const ttGate = page.locator('#af-profile-dialog [data-af="pref"][data-id="tt"]');
  const assignGate = page.locator('#af-profile-dialog [data-af="pref"][data-id="assign"]');
  const ttWasGate = await ttGate.isChecked();
  const assignWasGate = await assignGate.isChecked();
  await ttGate.click();
  await page.waitForTimeout(55);
  await assignGate.click();
  await page.waitForTimeout(55);
  await page.waitForFunction(() => window.NotificationDemoStore.getPendingWriteCount() >= 2);
  ok((await page.evaluate(() => window.NotificationDemoStore.getSaveStatus())) === "saving", "saving while first PUT gated and second queued");
  releasePut1();
  await page.waitForFunction(() => window.NotificationDemoStore.getPendingWriteCount() >= 1);
  ok((await page.evaluate(() => window.NotificationDemoStore.getSaveStatus())) === "saving", "still saving after first PUT completes with second pending");
  releasePut2();
  await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  ok((await page.evaluate(() => window.NotificationDemoStore.getPendingWriteCount())) === 0, "no pending writes when saved");
  await closeProfile();
  await page.unroute("http://127.0.0.1:34113/v1/demo-notification-state");
  await page.reload();
  await page.locator("#af-profile-btn").click();
  ok((await ttGate.isChecked()) === !ttWasGate, "tt pref persisted after overlapping PUTs");
  ok((await assignGate.isChecked()) === !assignWasGate, "assign pref persisted after overlapping PUTs");
  await closeProfile();

  await page.route("http://127.0.0.1:34113/**", (route) => route.abort("failed"));
  await page.locator("#af-profile-btn").click();
  await page.locator('#af-profile-dialog [data-af="pref"][data-id="tt"]').click();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  ok((await page.locator("#af-profile-store-status").textContent()).includes("не удалось сохранить"), "backend failure message visible near profile preferences");
  ok((await page.locator("#af-save-status").getAttribute("data-state")) === "failed", "compact header failure indicator only");
  ok(await page.locator("#af-save-status").evaluate((el) => getComputedStyle(el).whiteSpace === "nowrap"), "header failure indicator does not wrap");
  await page.locator('#af-profile-dialog [data-af="profile-close"]').click();
  await page.setViewportSize({ width: 375, height: 812 });
  ok(await page.locator(".head .logo").isVisible(), "375px header logo preserved");
  ok((await page.locator(".head .right").evaluate((el) => el.scrollWidth <= el.clientWidth + 2)), "375px header right cluster no overflow");
  await page.setViewportSize({ width: 1440, height: 900 });
  ok(await page.locator(".head .brand").isVisible(), "1440px header brand visible");
  await page.unroute("http://127.0.0.1:34113/**");

  await page.goto(`${base}/#exchange?role=manager`);
  await page.waitForTimeout(300);
  ok(errors.length === 0, "no page errors from start through flows");

  return { passed: checks.length, checks, pageErrors: errors };
})();
console.log(JSON.stringify(NOTIFICATION_CENTER_QA, null, 2));
