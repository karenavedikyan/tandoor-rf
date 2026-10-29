var NOTIFICATION_CENTER_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Notification center QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const bell = () => page.locator("#af-bell").click();
  const closeInbox = () => page.locator('#af-inbox [data-af="close-inbox"]').click();

  await page.goto(`${base}/#handover?as_role=manager`);
  await page.reload();
  ok(await page.locator("#af-bell").count() === 1, "single header bell");
  await bell();
  ok((await page.locator("#af-inbox h2").textContent()).includes("Центр уведомлений"), "inbox title unified center");
  ok((await page.locator(".af-inbox-cats").textContent()).includes("Тан-трекер"), "category filters visible");
  const beforeRead = await page.locator(".af-note.af-unread").count();
  ok(beforeRead >= 1, "unread styling present");
  await page.locator('[data-af="read"]').first().click();
  await page.reload();
  await bell();
  ok((await page.locator(".af-note.af-unread").count()) <= beforeRead - 1, "read state persists after reload");
  await closeInbox();

  await page.locator("#af-profile-btn").click();
  await page.locator("#af-profile-dialog").waitFor({ state: "visible" });
  ok((await page.locator("#af-profile-dialog").textContent()).includes("Telegram"), "profile delivery settings");
  ok((await page.locator("#af-profile-dialog").textContent()).includes("MAX"), "MAX channel in profile");
  await page.locator('[data-af="connect-telegram"]').click();
  ok((await page.locator("#af-profile-dialog").textContent()).includes("Подключено (демо)"), "demo telegram connect");
  await page.locator('[data-af="delivery-retry"]').click();
  await page.locator("#af-profile-dialog").waitFor({ state: "hidden" });
  await bell();
  ok((await page.locator("#af-inbox").textContent()).includes("Telegram"), "inbox shows delivery line when connected");
  await page.locator('[data-af="cat-tt"]').click();
  ok((await page.locator(".af-note").count()) >= 1, "tan-tracker category filter");
  await closeInbox();

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await bell();
  ok((await page.locator("#af-inbox").getByRole("button", { name: "Открыть трек", exact: true }).count()) >= 1, "TT events share same center");
  await closeInbox();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
  await bell();
  ok(await page.locator("#af-inbox").evaluate((e) => e.getBoundingClientRect().right <= innerWidth), "375px dark inbox fits");
  await page.keyboard.press("Escape");
  ok(await page.locator("#af-inbox").count() === 0, "Escape closes inbox");

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#exchange?role=manager`);
  await page.waitForTimeout(400);
  ok(errors.length === 0, "no console page errors on clients route");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(NOTIFICATION_CENTER_QA, null, 2));
