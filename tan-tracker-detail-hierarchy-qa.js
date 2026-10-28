var TT_DETAIL_HIERARCHY_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail hierarchy QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const openOrder = async (id) => {
    await page.locator(`.tt-table [data-tt-open="${id}"]`).click();
    await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  };
  const noOverflow = async () => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    ok(w, "no horizontal overflow");
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok(await page.locator(".tt-detail-title").count() === 1, "detail shows prominent item title");
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Доставить"), "detail due line labeled");
  await page.locator('[data-tt="detail-route-disclosure"] summary').click();
  ok(await page.locator('[data-tt="route-node"]').count() >= 2, "detail route nodes for holder and destination");
  ok(await page.locator('[data-tt="enter-code"]').count() === 1, "pending holder primary enter-code visible");
  ok(await page.locator(".tt-seg").count() === 0, "no equal-width code/QR tabs on detail");
  await ttOpenOtherActions();
  ok(await page.locator('[data-tt="cancel-pending"]').isVisible(), "cancel pending in other actions disclosure");
  await page.locator('[data-tt="other-actions"] summary').click();
  ok((await page.locator('[data-tt="history-panel"], [data-tt="history-disclosure"]').count()) >= 1, "history block present");
  const historySummary = page.locator('[data-tt="history-disclosure"] summary');
  if (await historySummary.isVisible()) await historySummary.click();
  ok((await page.locator('[data-tt="timeline"] div').count()) >= 1, "history shows timeline");
  await noOverflow();

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-002`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-detail-primary .tt-primary").count()) === 1, "holder sees exactly one primary CTA");

  await page.goto(`${base}/#tan-tracker?role=coordinator&tt_emp=c1&tt_id=TT-2026-012`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-detail-primary").textContent()).includes("Передать"), "holder without pending shows relay/transfer primary");
  ok(await page.locator('[data-tt="handoff-panel"]').count() === 0, "no handoff panel without pending");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-002`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok(await page.locator('[data-tt="enter-code"]').count() === 0, "non-holder read-only has no enter-code");
  ok(await page.locator('[data-tt="transfer"]').count() === 0, "non-holder has no transfer action");
  ok(await page.locator('[data-tt="detail-task-readonly"]').count() === 1, "non-holder info task card");
  ok((await page.locator('[data-tt="detail-task-readonly"]').textContent()).includes("Только просмотр"), "non-holder read-only hint shown");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  ok((await page.locator(".tt-detail-task-heading").textContent()).includes("Передача завершена"), "completed shows terminal heading");
  ok((await page.locator(".tt-detail-task-card--terminal").count()) === 1, "completed terminal task card");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#clients?role=manager`);
  await page.locator(".main").waitFor({ state: "visible" });
  if ((await page.locator("#af-required-reminder").count()) === 0) {
    await page.evaluate(() => {
      const r = document.createElement("div");
      r.id = "af-required-reminder";
      r.className = "af af-required-reminder";
      r.innerHTML = "<div><strong>Оцените завершённую работу · 1</strong><span>Обязательный шаг</span></div><button type=\"button\">Поставить оценку</button>";
      document.getElementById("app").append(r);
    });
  }
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  const enterLoc = page.locator('[data-tt-detail-hero-primary][data-tt="enter-code"]').first();
  await enterLoc.waitFor({ state: "visible" });
  ok(await page.locator("#af-required-reminder").count() === 0, "required reminder suppressed on TT detail");
  ok(await page.evaluate(() => document.body.classList.contains("tt-detail-focus")), "detail focus body class set");
  await enterLoc.click({ trial: true });
  ok(true, "375px enter-code clickable (sticky dock or inline)");
  const box = await enterLoc.boundingBox();
  ok(
    box && box.y + box.height <= 812 + 2,
    "375px primary action visible in viewport (inline or sticky dock)"
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await noOverflow();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  ok(await page.locator('.tt-demo-head-popover[data-tt="demo-settings"]').evaluate((el) => !el.open), "demo settings closed by default on registry");
  await ttOpenDemoSettings();
  ok(await page.locator('[data-tt="employee"]').isVisible(), "employee switcher discoverable in demo settings");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  if ((await page.locator('[data-tt="qr-host"]').count()) === 0) await page.locator('[data-tt="tab-qr"]').click();
  ok(await page.locator('[data-tt="qr-host"] svg').count() >= 1, "secondary QR reveals demo QR");
  await page.locator('[data-tt="enter-code"]').click();
  ok(await page.locator('[data-tt="code-input"]').isVisible(), "enter-code opens code entry screen");
  await page.locator('[data-tt="code-input"]').fill("000000");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).length > 5, "code entry shows validation feedback");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_HIERARCHY_QA, null, 2));
