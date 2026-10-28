var TT_DEMO_CODE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker demo code QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-screen"]').waitFor({ state: "visible" });
  ok(
    (await page.getByLabel("6-значный код", { exact: true }).getAttribute("data-tt")) === "code-input",
    "code input accessible name is exactly 6-значный код without button text"
  );
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  await page.locator('[data-tt="holder-shown-code"]').waitFor({ state: "visible" });
  const code1 = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  ok(/^\d{6}$/.test(code1), "initial demo code is six digits");
  ok((await page.locator("#tt-code-demo-help").textContent()).includes("без СМС"), "demo-only no-SMS explanation");
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  const code2 = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  ok(code1 === code2, "repeat click reuses valid demo code");

  await page.locator('[data-tt="code-input"]').fill("000000");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("Неверный"), "wrong code rejected without handoff");
  const holderBefore = await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").holderId);
  await page.locator('[data-tt="code-input"]').fill(code1);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001").holderId)) !== holderBefore,
    "manual confirm completes handoff after demo reveal"
  );

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004`);
  await page.reload();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt-pick="ext_01"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  const live = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  await page.getByRole("button", { name: "Истечь срок кода (демо)", exact: true }).click();
  ok((await page.locator('[data-tt="holder-shown-code"]').count()) === 0, "expired code hides demo display until re-reveal");
  await page.locator('[data-tt="code-input"]').fill(live);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("истёк"), "expired code rejected on confirm");
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  const fresh = (await page.locator('[data-tt="holder-shown-code"] .tt-code-inline').textContent()).trim();
  ok(fresh !== live, "after expiry demo reveal issues fresh code");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_screen=code&tt_id=TT-2026-010`);
  await page.reload();
  await page.locator('[data-tt="code-screen"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  ok((await page.locator('[data-tt="holder-shown-code"]').count()) === 0, "non-holder sees no demo code");
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("держател"), "non-holder demo code rejected");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_screen=code&tt_id=TT-2026-009`);
  await page.reload();
  await page.getByRole("button", { name: "Получить демо-код", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("заверш"), "completed order rejects demo code");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="enter-code"]').click();
  ok(await page.getByRole("button", { name: "Получить демо-код", exact: true }).isVisible(), "375px demo code button visible");
  const inputBox = await page.locator('[data-tt="code-input"]').boundingBox();
  ok(inputBox && inputBox.height <= 64, "375px code input height at most 64px not flex-stretched");
  const confirmBtn = page.getByRole("button", { name: "Подтвердить", exact: true });
  const confirmBox = await confirmBtn.boundingBox();
  ok(confirmBox && confirmBox.y + confirmBox.height <= 812, "375px confirm button in viewport");
  const confirmHit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Подтвердить");
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === btn || btn.contains(el);
  });
  ok(confirmHit, "375px confirm button hit-test reachable");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  ok(await page.locator('[data-tt="code-input"]').isVisible(), "dark theme code input visible");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DEMO_CODE_QA, null, 2));
