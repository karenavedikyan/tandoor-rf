var TT_ROLE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker role QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const rowCount = async () => page.locator("#tt-registry-body tr[data-tt-open]").count();

  await page.goto(`${base}/#exchange?role=director`);
  await page.reload();
  await page.evaluate(() => {
    location.hash = "#tan-tracker";
  });
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const implicitRows = await rowCount();
  ok(implicitRows > 0 && implicitRows < 21, "tan-tracker without role param does not inherit global director full registry");

  await page.goto(`${base}/#tan-tracker?role=assistant`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const asstRows = await rowCount();
  ok(asstRows > 0 && asstRows < 21, "explicit assistant uses participant scope not director-wide registry");

  await page.goto(`${base}/#tan-tracker?role=assistant&tt_id=TT-2026-008`);
  await page.reload();
  ok((await page.locator("#tt-content").textContent()).includes("Нет доступа"), "assistant forbidden on unrelated TT-2026-008 direct hash");

  await page.goto(`${base}/#tan-tracker?as_role=assistant&as_person=a1&tt_id=TT-2026-007`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-007"), "as_role/as_person alias opens participant order");

  await page.goto(`${base}/#tan-tracker?role=intern`);
  await page.reload();
  ok((await page.locator('[data-tt="unsupported-role"]').count()) === 1, "unknown role shows unsupported profile not registry");
  ok((await page.locator("#tt-registry-body").count()) === 0, "unknown role hides registry rows");
  await page.goto(`${base}/#tan-tracker?role=intern&tt_id=TT-2026-001`);
  await page.reload();
  ok((await page.locator('[data-tt="unsupported-role"]').count()) === 1, "unknown role blocks direct hash without metadata leak");

  await page.goto(`${base}/#tan-tracker?role=coordinator&tt_id=TT-2026-012`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("TT-2026-012"), "coordinator c1 participant scope on own track");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_ROLE_QA, null, 2));
