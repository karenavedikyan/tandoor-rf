var TT_DETAIL_TERMINAL_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail terminal QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="enter-code"]').click();
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  const code = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  await page.locator('[data-tt="code-input"]').fill(code);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail-task-card"]').waitFor({ state: "visible" });

  ok((await page.locator('[data-tt-terminal-audience="contributor"]').count()) === 1, "initiator sees contributor terminal after code delivery");
  ok((await page.locator('[data-tt="detail-completed"]').textContent()).includes("Вы свою часть выполнили"), "personal success copy");
  ok((await page.locator('[data-tt="detail-terminal-monitor"]').textContent()).includes("Подтверждение получения"), "verified delivery shows confirmation time");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 0, "terminal has no handoff mutation");
  ok((await page.locator('[data-tt="detail-terminal-nav"] .tt-primary').count()) === 1, "single primary back navigation");

  await page.setViewportSize({ width: 375, height: 812 });
  const box = await page.locator('[data-tt="terminal-back-list"]').boundingBox();
  ok(box && box.y + box.height <= 812, "375 first screen back CTA in viewport");
  await page.locator('[data-tt="terminal-back-list"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').count()) === 0, "back-list returns to registry");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-005`);
  await page.reload();
  ok((await page.locator('[data-tt-terminal-audience="observer"]').count()) === 1, "non-participant observer terminal");
  ok(!(await page.locator('[data-tt="detail-completed"]').textContent()).includes("Вы свою часть"), "observer not personal success");
  ok(
    !(await page.locator('[data-tt="detail-terminal-monitor"]').textContent()).includes("Подтверждение получения"),
    "legacy completion no fabricated code confirmation"
  );

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  ok((await page.locator(".tt-detail-task-heading").textContent()).includes("Передача завершена"), "header unchanged for legacy completed");
  ok((await page.locator('[data-tt-terminal-audience="contributor"]').count()) === 1, "legacy initiator still contributor audience");
  ok(
    !(await page.locator('[data-tt="detail-terminal-monitor"]').textContent()).includes("Подтверждение получения"),
    "legacy completed with only intermediate handoffs — no final receipt claim"
  );

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  ok((await page.locator('[data-tt="detail-terminal-nav"] .tt-primary').count()) === 1, "dark theme single primary on terminal");

  return { passed: checks.length, checks };
})();

console.log(JSON.stringify(TT_DETAIL_TERMINAL_QA, null, 2));
