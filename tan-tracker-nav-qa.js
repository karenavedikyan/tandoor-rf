var TT_NAV_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker nav QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const navCount = () => page.locator('[data-go="tan-tracker"]').count();
  const openViaNav = async () => {
    const btn = page.locator('.sidebar .nav [data-go="tan-tracker"]').first();
    await btn.waitFor({ state: "visible" });
    await btn.click();
    await page.locator("#tt-root").waitFor({ state: "visible" });
  };

  await page.goto(`${base}/#tan-tracker?role=director`);
  ok((await navCount()) === 1, "director hash entry shows tan-tracker nav once");
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.locator(".tt-table tbody tr").count()) >= 21, "director tracker registry at least 21 rows");

  await page.goto(`${base}/#exchange?role=manager`);
  ok((await navCount()) === 1, "exchange clients deep link shows tan-tracker nav");
  await openViaNav();
  ok(await page.locator("#tt-root").count() === 1, "tracker from exchange entry");

  await page.goto(`${base}/#territory-sales?role=manager`);
  ok((await navCount()) === 1, "sales deep link shows tan-tracker nav");

  await page.goto(`${base}/#exchange?role=director`);
  ok((await navCount()) === 1, "director exchange shows tan-tracker nav");
  await openViaNav();
  ok((await page.locator(".tt-table tbody tr").count()) >= 21, "director nav opens 21+ row registry");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#exchange?role=manager`);
  await page.locator("[data-menu]").click();
  ok(await page.locator(".sidebar.open [data-go=\"tan-tracker\"]").count() === 1, "mobile menu exposes tan-tracker");
  await page.locator(".sidebar.open [data-go=\"tan-tracker\"]").click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok(await page.locator("#tt-root").count() === 1, "mobile nav opens tracker");

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#tan-tracker?role=manager`);
  await page.reload();
  ok((await navCount()) === 1, "tracker refresh keeps single nav item");
  await page.locator('[data-go="exchange"]').click();
  await page.locator("#tt-root").waitFor({ state: "detached" });
  await page.locator(".screenbody .x6.x13").waitFor({ state: "visible" });
  ok(await page.locator("#tt-root").count() === 0, "exchange nav leaves tracker");
  ok((await page.evaluate(() => (location.hash.split("?")[0] || "#").replace(/^#/, ""))) === "exchange", "exchange is clients target route");
  ok((await navCount()) === 1, "exchange view keeps single tan-tracker nav");

  await page.evaluate(() => {
    render();
    render();
  });
  ok((await navCount()) === 1, "double shell render does not duplicate tan-tracker nav");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_NAV_QA, null, 2));
