var TT_HANDOFF_IDENTITY_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker handoff identity QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const navHash = async (h) => {
    await page.evaluate((hash) => {
      location.hash = hash.startsWith("#") ? hash : "#" + hash;
    }, h);
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-003`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Смотреть как текущий держатель (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Открыть экран получателя", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const codeExt = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(codeExt);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="handoff-receipt"]').waitFor({ state: "visible" });
  ok(await page.evaluate(() => document.body.classList.contains("tt-external-shell")), "external code sender stays external shell");
  ok(await page.locator(".sidebar").isHidden(), "external code sender hides sidebar");
  ok(await page.locator("#af-bell").isHidden(), "external code sender hides corporate bell");
  ok((await page.locator('[data-tt="handoff-receipt"]').textContent()).includes("Анна"), "external code sender positive receipt names employee receiver");
  ok((await page.locator(".tt-att-item").count()) === 0, "external code sender receipt hides private attachments");
  ok(!(await page.evaluate(() => location.hash)).includes("tt_emp=m1"), "external code sender receipt does not expose staff m1 profile in URL");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt="confirm-transfer"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="pickQ"]').fill("Савельева");
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.locator('[data-tt="tab-qr"]').click();
  const qrRaw = await page.locator('[data-tt="qr-host"]').getAttribute("data-payload");
  const recipientHash = qrRaw.includes("#") ? qrRaw.slice(qrRaw.indexOf("#")) : "#" + qrRaw;
  await navHash(recipientHash);
  await page.locator('[data-tt="recipient-screen"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить получение", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.evaluate(() => location.hash)).includes("tt_emp=c1"), "employee QR receipt keeps verified c1 not default m1");
  ok((await page.locator('[data-tt="employee"]').inputValue()) === "c1", "employee QR receipt UI selector stays c1");
  ok(await page.locator(".sidebar").isVisible(), "employee QR receipt keeps corporate shell sidebar");
  ok(!(await page.evaluate(() => document.body.classList.contains("tt-external-shell"))), "employee QR receipt is not external shell");
  ok(!(await page.evaluate(() => location.hash)).includes("tt_act="), "employee QR receipt clears external tt_act");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_HANDOFF_IDENTITY_QA, null, 2));
