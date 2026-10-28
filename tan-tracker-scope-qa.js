var TT_SCOPE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker scope QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const ids = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#tt-registry-body tr[data-tt-open]")].map((r) => r.getAttribute("data-tt-open"))
    );

  await page.goto(`${base}/#tan-tracker?role=director`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const dirIds = await ids();
  ok(dirIds.length >= 21, "director sees 21+ transfers");
  ok(dirIds.includes("TT-2026-008"), "director sees orlov-only order TT-2026-008");

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const mgrIds = await ids();
  ok(mgrIds.length > 0 && mgrIds.length < dirIds.length, "manager sees restricted subset not full registry");
  ok(mgrIds.includes("TT-2026-001") || mgrIds.includes("TT-2026-021"), "manager sees own-team participant rows");
  ok(mgrIds.includes("TT-2026-020"), "manager m1 retains read for historical sender track TT-2026-020");
  ok(!mgrIds.includes("TT-2026-008"), "manager does not see orlov-only TT-2026-008");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-020`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-020"), "manager opens historical sender order TT-2026-020");

  await page.goto(`${base}/#tan-tracker?role=rop`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const ropIds = await ids();
  ok(ropIds.length >= mgrIds.length, "rop volkova team sees at least manager scope");
  ok(!ropIds.includes("TT-2026-008"), "rop volkova does not see orlov-only participant order TT-2026-008");
  ok(mgrIds.every((id) => ropIds.includes(id)), "rop scope covers manager permitted ids");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-008`);
  await page.reload();
  ok((await page.locator("#tt-content").textContent()).includes("Нет доступа"), "forbidden direct hash shows access denied for unrelated TT-2026-008");
  ok((await page.locator('[data-tt="access-denied"]').count()) === 1, "access denied marker present");

  await page.goto(`${base}/#tan-tracker?role=director&tt_id=TT-2026-008`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-008"), "director opens forbidden-for-manager order");

  ok(mgrIds.length < dirIds.length, "manager row count strictly below director (no full-registry leak)");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-021`);
  await page.reload();
  await page.getByRole("button", { name: "Смотреть как текущий держатель (демо)", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Сергей"), "driver demo sees final recipient on TT-2026-021");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-016`);
  await page.reload();
  await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').first().click();
  await page.locator('[data-tt-pick="emp_a1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.locator('[data-tt="change-pending"]').click();
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Ольга"), "pending recipient replaced before revoke check");
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=assistant&tt_emp=a1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="access-denied"]').waitFor({ state: "visible" });
  ok((await page.locator("#tt-content").textContent()).includes("Нет доступа"), "revoked pending employee cannot open order");
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=rop&tt_emp=r1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-016"), "rop keeps own-team track after canceled pending revoke");
  ok((await page.locator(".tt-att-item").count()) === 0, "revoked pending employee sees no attachments");
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-016"), "actual sender manager still reads order after recipient replace");

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=director&tt_emp=d1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-016"), "director reads order even when revoked pending list populated");

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="change-pending"]').click();
  await page.locator('[data-tt-pick="emp_a1"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=assistant&tt_emp=a1&tt_id=TT-2026-016";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-016"), "reselected pending employee regains access after revoke cleared");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_SCOPE_QA, null, 2));
