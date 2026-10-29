var TT_EXTERNAL_MESSENGER_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("External messenger QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-pick="ext_01"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await ttOpenDetailDemo();
  ok(await page.locator('[data-tt="invite-url"]').isVisible(), "holder sees personal invite link");
  const invite = await page.locator('[data-tt="invite-url"]').textContent();
  ok(invite.includes("tt_st="), "invite carries start token");
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  ok(/^\d{6}$/.test(code), "telegram path issues code on recipient screen only");
  await page.locator('[data-tt="exit-recipient"]').click();
  ok((await page.locator('[data-tt="demo-reveal-code"]').count()) === 0, "external pending hides holder demo code");
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(code);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="handoff-receipt"], [data-tt="detail"]').first().waitFor({ state: "visible" });
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-004").holderId)) === "ext_01",
    "holder manual code confirms custody"
  );
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-006`);
  await page.reload();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  ok(await page.locator('[data-tt="pick-channel"][data-channel="max"]').isDisabled(), "MAX disabled without demo checkbox");
  await ttOpenDemoSettings();
  await page.locator('[data-tt="demo-max-enabled"]').check();
  await page.waitForFunction(
    () => window.TanTrackerMessengerDemo?.channelAvailability?.().max?.available === true
  );
  await page.locator('[data-tt="pick-channel"][data-channel="max"]:not([disabled])').click();
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.locator('[data-tt="messenger-verified"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  ok((await page.locator('[data-tt="shown-code"]').textContent()).trim().length === 6, "MAX enabled via visible demo settings checkbox");
  const bad = await page.evaluate(async () => {
    window.TanTrackerPrototype.pickMessengerChannel("telegram");
    return window.TanTrackerPrototype.simulateMessengerContact("wrong_phone");
  });
  ok(bad && bad.ok === false, "wrong phone rejected");
  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_EXTERNAL_MESSENGER_QA, null, 2));
