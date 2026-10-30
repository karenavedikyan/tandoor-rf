var TT_INVITATION_WELCOME_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Invitation welcome QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const navHash = async (h) => {
    await page.evaluate((hash) => {
      location.hash = hash.startsWith("#") ? hash : "#" + hash;
    }, h);
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-pick="ext_01"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await ttOpenDetailDemo();
  ok(await page.locator('[data-tt="invite-message-preview"]').isVisible(), "holder sees invite message preview");
  ok(await page.locator('[data-tt="invite-message-text"]').isVisible(), "holder sees selectable invite fallback");
  ok(await page.locator('[data-tt="copy-invite-message"]').isVisible(), "copy full invitation control");
  const previewText = await page.locator('[data-tt="invite-message-preview"]').textContent();
  ok(previewText.includes("Вам передают предмет") && previewText.includes("Посмотреть передачу"), "preview card copy");
  const inviteUrl = await page.locator('[data-tt="invite-url"]').textContent();
  ok(inviteUrl.includes("tt_st="), "canonical invite url with token");
  if (await page.locator('[data-tt="tab-code"]').count()) await page.locator('[data-tt="tab-code"]').click();

  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.locator('[data-tt="recipient-welcome"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="recipient-welcome-continue"]').count()) === 1, "welcome CTA on valid link");
  ok((await page.locator('[data-tt="shown-code"]').count()) === 0, "welcome open does not show code");
  ok((await page.locator('[data-tt="pick-channel"]').count()) === 0, "welcome open hides messenger pick");
  await page.locator('[data-tt="recipient-welcome-about"] summary').click();
  ok((await page.locator('[data-tt="recipient-welcome-about"]').evaluate((el) => el.open)), "about disclosure opens");
  await page.locator('[data-tt="recipient-welcome-continue"]').click();
  await page.locator('[data-tt="recipient-screen"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="recipient-messenger-preamble"]').isVisible(), "messenger preamble after continue");
  await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
  ok((await page.locator('[data-tt="recipient-step-verify"]').textContent()).includes("Telegram"), "channel-specific verify label");
  await page.getByRole("button", { name: /Поделиться контактом/ }).click();
  await page.locator('[data-tt="messenger-verified"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  ok(/^\d{6}$/.test(code), "code only after verify");
  await page.locator('[data-tt="exit-recipient"]').click();

  const hashOnly = inviteUrl.trim().includes("#") ? inviteUrl.trim().slice(inviteUrl.trim().indexOf("#")) : `#${inviteUrl.trim()}`;
  await navHash(hashOnly);
  await page.locator('[data-tt="recipient-welcome"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="recipient-welcome-continue"]').isVisible(), "cold link shows welcome again");

  const badHash = hashOnly.replace(/tt_st=[^&]+/, "tt_st=invalid_token_demo");
  await navHash(badHash);
  await page.locator('[data-tt="recipient-welcome-invalid"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="recipient-welcome-continue"]').count()) === 0, "bad token has no CTA");
  ok((await page.locator('[data-tt="pick-channel"]').count()) === 0, "bad token hides receive controls");

  const staleHash = hashOnly.replace(/tt_hv=\d+/, "tt_hv=999");
  await navHash(staleHash);
  await page.locator('[data-tt="recipient-welcome-invalid"]').waitFor({ state: "visible" });
  ok((await page.textContent("body")).includes("устарел"), "stale hv invitation calm copy");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-006`);
  await page.reload();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await ttAckRecipientWelcome();
  ok(await page.locator('[data-tt="pick-channel"][data-channel="max"]').isDisabled(), "MAX disabled before demo toggle");
  await ttOpenDemoSettings();
  await page.locator('[data-tt="demo-max-enabled"]').check();
  await page.waitForFunction(() => window.TanTrackerMessengerDemo?.channelAvailability?.().max?.available === true);
  await page.locator('[data-tt="pick-channel"][data-channel="max"]:not([disabled])').click();
  ok((await page.locator('[data-tt="recipient-step-verify"]').textContent()).includes("MAX"), "MAX label after pick");
  await page.locator('[data-tt="exit-recipient"]').click();

  await page.setViewportSize({ width: 320, height: 640 });
  await navHash("#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-006");
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  const ctaBox = await page.locator('[data-tt="recipient-welcome-continue"]').boundingBox();
  ok(ctaBox && ctaBox.height >= 44, "welcome CTA touch target 320px");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await navHash("#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-006");
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  ok(await page.locator('[data-tt="recipient-welcome"]').isVisible(), "dark theme welcome");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_INVITATION_WELCOME_QA, null, 2));
