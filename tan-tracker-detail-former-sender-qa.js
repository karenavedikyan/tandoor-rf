var TT_DETAIL_FORMER_SENDER_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail former sender QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const reopenOrder = async (orderId) => {
    await page.locator('[data-tt="back-list"]').click();
    await page.locator(`[data-tt-open="${orderId}"]`).first().click();
    await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 0, "pending holder before confirm is not former-sender card");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 1, "pending creator-holder still has handoff action");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  ok((await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').count()) >= 1, "returned holder regains handoff actions");
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-field="pickQ"]').fill("Савельева");
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 0, "sender still active while pending unconfirmed");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 1, "sender keeps handoff action before code confirm");

  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-screen"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  await page.locator('[data-tt="holder-shown-code"]').waitFor({ state: "visible" });
  const code = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  await page.locator('[data-tt="code-input"]').fill(code);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });

  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 1, "sender sees former-holder card after relay code handoff");
  const former = await page.locator('[data-tt="detail-task-former"]').textContent();
  ok(former.includes("Вы передали предмет") && former.includes("этап завершён"), "former card completion copy");
  ok(former.includes("Савельева") || former.includes("Наталья"), "former card names relay holder after handoff");
  const monitor = await page.locator('[data-tt="detail-monitor"]').textContent();
  ok(monitor.includes("У кого сейчас предмет"), "monitor custody label without case inflection");
  ok(!monitor.includes("у Наталья") && !monitor.includes("у Сергей"), "monitor value is plain name without у");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 0, "former sender has no mutation CTA");

  await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-004");
    const at = Date.now();
    o.timeline.push({ at, from: "emp_c1", to: "ext_01", note: "Подтверждено по QR" });
    o.holderId = "ext_01";
    o.holderSince = at;
    o.pendingId = null;
    o.status = "active";
  });
  await reopenOrder("TT-2026-004");
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 1, "original sender keeps stage-complete after later leg");
  ok((await page.locator('[data-tt="detail-task-readonly"]').count()) === 0, "original sender not generic read-only after relay chain");
  const monitorAfter = await page.locator('[data-tt="detail-monitor"]').textContent();
  ok(monitorAfter.includes("Сергей Приёмка") || monitorAfter.includes("Сергей"), "monitor shows third custodian plain name");
  ok(monitorAfter.includes("У кого сейчас предмет"), "monitor label unchanged after later leg");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 0, "original sender still has no mutation after chain");

  await page.evaluate(() => {
    const o = window.TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-004");
    o.holderId = "emp_m1";
    o.holderSince = Date.now();
    o.pendingId = null;
  });
  await reopenOrder("TT-2026-004");
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 0, "returned holder is not former-sender card");
  ok((await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').count()) >= 1, "returned holder regains handoff actions after fixture");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-002`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-task-readonly"]').count()) === 1, "generic observer stays read-only without confirmed handoff");
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 0, "observer is not former-sender card");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-completed"]').count()) >= 1, "completed order shows terminal not former stage");
  ok((await page.locator('[data-tt="detail-task-former"]').count()) === 0, "completed order not former-sender card");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_FORMER_SENDER_QA, null, 2));
