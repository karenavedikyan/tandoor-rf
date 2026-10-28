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

  await page.goto(`${base}/#tan-tracker?role=director`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const directorRows = await rowCount();
  ok(directorRows >= 21, "demo profile cycle starts with director full registry");
  ok((await page.locator('[data-tt="employee"]').inputValue()) === "d1", "director URL selects d1 employee");

  await page.locator('[data-tt="employee"]').selectOption("m2");
  await page.locator("#tt-registry-body tr[data-tt-open]").first().waitFor({ state: "visible" });
  const mgrRows = await rowCount();
  const m2Ids = await page.evaluate(() =>
    [...document.querySelectorAll("#tt-registry-body tr[data-tt-open]")].map((r) => r.getAttribute("data-tt-open"))
  );
  ok(mgrRows > 0 && mgrRows < directorRows, "selecting m2 applies manager participation scope not director-wide");
  ok(!m2Ids.includes("TT-2026-008"), "manager m2 does not see orlov-only TT-2026-008");
  ok((await page.evaluate(() => location.hash)).includes("tt_emp=m2"), "m2 selection persisted in URL");
  ok((await page.evaluate(() => location.hash)).includes("role=manager"), "m2 selection sets effective manager role in URL");

  await page.locator('[data-tt="employee"]').selectOption("r2");
  await page.locator("#tt-registry-body tr[data-tt-open]").first().waitFor({ state: "visible" });
  const r2Ids = await page.evaluate(() =>
    [...document.querySelectorAll("#tt-registry-body tr[data-tt-open]")].map((r) => r.getAttribute("data-tt-open"))
  );
  ok(r2Ids.includes("TT-2026-008"), "r2 ROP sees orlov team order TT-2026-008");

  await page.locator('[data-tt="employee"]').selectOption("d1");
  await page.locator("#tt-registry-body tr[data-tt-open]").nth(Math.min(20, directorRows - 1)).waitFor({ state: "visible" });
  ok((await rowCount()) >= 21, "selecting d1 restores director full registry");
  ok((await page.locator('[data-tt="employee"] option:checked').textContent()).includes("Директор"), "d1 option label includes director role");

  const openId = await page.locator("#tt-registry-body tr[data-tt-open]").first().getAttribute("data-tt-open");
  await page.locator(`tr[data-tt-open="${openId}"]`).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="back-list"]').click();
  await page.locator("#tt-registry-body").waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="employee"]').inputValue()) === "d1", "demo employee d1 preserved after detail and back");
  ok((await rowCount()) >= 21, "director scope preserved after detail and back");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_ROLE_QA, null, 2));
