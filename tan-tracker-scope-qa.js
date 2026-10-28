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
  ok((await ids()).length >= 21, "director sees 21+ transfers");

  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const mgrIds = await ids();
  ok(mgrIds.length > 0 && mgrIds.length < 21, "manager sees restricted subset not full registry");
  ok(mgrIds.includes("TT-2026-001") || mgrIds.includes("TT-2026-021"), "manager sees own-team participant rows");

  await page.goto(`${base}/#tan-tracker?role=rop`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const ropIds = await ids();
  ok(ropIds.length >= mgrIds.length, "rop volkova team sees at least manager scope");
  ok(!ropIds.includes("TT-2026-008"), "rop volkova does not see orlov-only participant order TT-2026-008");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_id=TT-2026-020`);
  await page.reload();
  ok(await page.locator('[data-tt="access-denied"]').isVisible(), "forbidden direct hash shows access denied");

  await page.goto(`${base}/#tan-tracker?role=director&tt_id=TT-2026-020`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-020"), "director opens forbidden-for-manager order");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_SCOPE_QA, null, 2));
