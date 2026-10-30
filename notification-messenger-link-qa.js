var NOTIFICATION_MESSENGER_LINK_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Messenger link QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const visitor = "nc-messenger-link-qa-" + Date.now();
  await page.addInitScript((id) => {
    window.__NOTIFICATION_DEMO_VISITOR__ = id;
  }, visitor);
  await page.goto(`${base}/#handover?as_role=manager`);
  await page.evaluate(async () => {
    await window.NotificationDemoStore?.resetRemote?.();
  });
  await page.locator("#af-profile-btn").click();
  await page.locator("#af-profile-dialog").waitFor({ state: "visible" });
  ok((await page.locator(".af-connect-consent").count()) >= 1, "consent copy visible before connect");
  await page.locator('[data-af="begin-connect-telegram"]').click();
  await page.locator('[data-af="bot-panel"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "/start (общий бот)", exact: true }).click();
  ok((await page.locator(".af-bot-msg").textContent()).includes("не привязывает"), "generic start does not link account");
  ok((await page.locator('[data-af="channel-telegram"] .af-channel-on').count()) === 0, "generic start leaves channel disconnected");
  await page.getByRole("button", { name: "Start · активировать привязку", exact: true }).click();
  ok((await page.locator('[data-af="channel-telegram"] .af-channel-on').count()) === 1, "personal start completes in one step without profile re-open");
  ok((await page.locator('[data-af="begin-connect-telegram"]').count()) === 0, "no second activation step after connect");
  const ttPref = page.locator('[data-af="pref"][data-id="tt"]');
  ok(await ttPref.isChecked(), "existing tt notification pref preserved on connect");
  await page.locator('[data-af="pref"][data-id="assign"]').uncheck();
  await page.evaluate(() => window.AssistantFeedback.flushDemoStore());
  await page.reload();
  await page.locator("#af-profile-btn").click();
  ok(!(await page.locator('[data-af="pref"][data-id="assign"]').isChecked()), "opt-out pref survives reload");
  ok((await page.locator('[data-af="channel-telegram"] .af-channel-on').count()) === 1, "telegram connected survives reload");
  await page.locator('[data-af="demo-max-lk"]').check();
  await page.locator('[data-af="begin-connect-max"]').click();
  await page.getByRole("button", { name: "Start · активировать привязку", exact: true }).click();
  ok((await page.locator('[data-af="channel-max"] .af-channel-on').count()) === 1, "MAX connects after explicit demo toggle");
  await page.locator('[data-af="disconnect-telegram"]').click();
  await page.locator('[data-af="disconnect-max"]').click();
  ok((await page.locator(".af-channel-on").count()) === 0, "disconnect clears both channels");
  await page.setViewportSize({ width: 375, height: 812 });
  ok(await page.locator("#af-profile-dialog").isVisible(), "profile delivery settings visible at 375px");
  await page.locator('[data-af="profile-close"]').click();
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click({ force: true });
  await page.locator("#af-profile-btn").click();
  ok(await page.locator(".af-connect-consent").first().isVisible(), "consent visible after theme toggle at mobile width");
  await page.locator('[data-af="profile-close"]').click();
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("sessionStorage blocked", "SecurityError");
      },
    });
  });
  await page.goto(`${base}/#handover?as_role=manager`);
  await page.locator("#af-profile-btn").click();
  await page.locator('[data-af="demo-max-lk"]').check();
  ok(
    await page.evaluate(() => window.AssistantFeedback.isMaxLkDemoEnabled() === true),
    "MAX demo toggle works when sessionStorage get/set throws"
  );
  ok((await page.locator('[data-af="begin-connect-max"]').count()) === 1, "MAX personal connect available after in-memory demo toggle");
  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(NOTIFICATION_MESSENGER_LINK_QA, null, 2));
