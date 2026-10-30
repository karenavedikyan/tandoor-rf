var TT_EXTERNAL_AFTER_CODE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("External after-code QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  async function externalCodeHandoff(orderId, emp, { reload = true } = {}) {
    if (reload) {
      await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=${emp}&tt_id=${orderId}`);
      await page.reload();
    }
    await page.locator("#tt-root, [data-tt='recipient-received']").first().waitFor({ state: "visible" });
    await ttOpenDetailDemo();
    await page.locator('[data-tt="open-recipient"]').click();
    await page.locator('[data-tt="recipient-screen"]').waitFor({ state: "visible" });
    const recipientHash = await page.evaluate(() => location.hash);
    await page.locator('[data-tt="pick-channel"][data-channel="telegram"]').click();
    await page.getByRole("button", { name: /Поделиться контактом/ }).click();
    await page.getByRole("button", { name: "Получить код", exact: true }).click();
    const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
    ok(/^\d{6}$/.test(code), `${orderId}: code issued for ${orderId}`);
    ok(await page.locator('[data-tt="bot-message-preview"]').isVisible(), `${orderId}: bot preview on code step`);
    const codePreview = await page.locator('[data-tt="bot-message-preview"] pre').textContent();
    ok(codePreview.includes(code), `${orderId}: bot preview includes code`);
    await page.locator('[data-tt="exit-recipient"]').click();
    await page.locator('[data-tt="enter-code"]').click();
    await page.locator('[data-tt="code-input"]').fill(code);
    await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await page.locator('[data-tt="detail"], [data-tt="handoff-receipt"]').first().waitFor({ state: "visible" });
    return recipientHash;
  }

  const finalHash = await externalCodeHandoff("TT-2026-001", "m1");
  ok(await page.locator('[data-tt="preview-recipient-received"]').isVisible(), "final: holder sees recipient preview demo btn");
  await page.locator('[data-tt="preview-recipient-received"]').click();
  await page.locator('[data-tt="recipient-received"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="recipient-received"] h1').textContent()).includes("Предмет у вас"), "final: preview opens received state");
  ok((await page.locator('[data-tt="recipient-received"] [data-tt="open-holder-page"]').count()) === 0, "final: no holder page button");
  const finalBot = await page.locator('[data-tt="bot-message-preview"] pre').textContent();
  ok(finalBot.includes("Передача дошла до вас") && finalBot.includes("делать ничего не нужно"), "final: bot received text");
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.evaluate((h) => {
    location.hash = h.startsWith("#") ? h : "#" + h;
  }, finalHash);
  await page.locator('[data-tt="recipient-received"]').waitFor({ state: "visible" });
  ok(!(await page.locator(".tt-warning").count()), "final: same recipient URL not stale after confirm");

  const relayHash = await externalCodeHandoff("TT-2026-018", "m3");
  await page.evaluate((h) => {
    location.hash = h.startsWith("#") ? h : "#" + h;
  }, relayHash);
  await page.locator('[data-tt="recipient-received"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="recipient-next-step"]').isVisible(), "intermediate: next-step block");
  ok((await page.locator('[data-tt="recipient-next-step"]').textContent()).includes("Передайте дальше"), "intermediate: relay hint");
  const relayBot = await page.locator('[data-tt="bot-message-preview"] pre').textContent();
  ok(relayBot.includes("Передайте дальше") && relayBot.includes("страница передачи"), "intermediate: bot received text");
  await page.locator('[data-tt="open-holder-page"]').click();
  await page.locator('[data-tt="holder-status-card"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="holder-next-step"]').isVisible(), "intermediate: external shell next step");
  ok(await page.getByRole("button", { name: "Передать дальше", exact: true }).isVisible(), "intermediate: transfer CTA on external shell");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.evaluate((h) => {
    location.hash = h.startsWith("#") ? h : "#" + h;
  }, relayHash);
  await page.locator('[data-tt="recipient-received"]').waitFor({ state: "visible" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  ok(!overflow, "375px: no horizontal overflow on received screen");
  const heroContrast = await page.locator('[data-tt="recipient-received"] .tt-recipient-hero').evaluate((el) =>
    window.ttQaContrastRatioOnElement(el)
  );
  ok(heroContrast >= 4.5, `dark: recipient-received hero contrast >= 4.5 (${heroContrast.toFixed(2)})`);
  const botContrast = await page.locator('[data-tt="bot-message-preview"] pre').evaluate((el) =>
    window.ttQaContrastRatioOnElement(el)
  );
  ok(botContrast >= 4.5, `dark: bot preview contrast >= 4.5 (${botContrast.toFixed(2)})`);

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_EXTERNAL_AFTER_CODE_QA, null, 2));
