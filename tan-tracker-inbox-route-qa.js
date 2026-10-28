var TT_INBOX_ROUTE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker inbox route QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const openInbox = async () => {
    await page.locator("#af-bell").click();
    await page.locator("#af-inbox").waitFor({ state: "visible" });
  };
  const closeInbox = async () => {
    await page.locator("#af-inbox").getByRole("button", { name: "Закрыть", exact: true }).click();
  };

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="employee"]').selectOption("m2");
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await openInbox();
  const nativeM2 = page.locator("#af-inbox").getByRole("button", { name: "Открыть назначение" }).first();
  await nativeM2.waitFor({ state: "visible" });
  await nativeM2.click();
  await page.waitForFunction(
    () => location.hash.includes("handover") && window.AssistantPrototype?.state?.person === "m2",
    null,
    { timeout: 10000 }
  );
  ok(
    (await page.evaluate(() => window.AssistantPrototype.state.person)) === "m2",
    "TT m2 native assignment notice routes handover as m2 not default m1"
  );

  await page.evaluate(() => {
    location.hash = "#tan-tracker?role=manager&tt_emp=m2&tt_id=TT-2026-002";
  });
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  await openInbox();
  await page.locator("#af-inbox").getByRole("button", { name: "Открыть трек", exact: true }).first().click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.evaluate(() => location.hash)).includes("tt_emp=m2"), "TT active tt-track open keeps selected m2 profile");

  await page.evaluate(() => {
    location.hash = "#handover?role=manager";
  });
  await page.locator("#as-content, .as-panel").first().waitFor({ state: "visible", timeout: 10000 });
  await openInbox();
  const ttOpen = page.locator("#af-inbox").getByRole("button", { name: "Открыть трек", exact: true }).first();
  ok((await ttOpen.count()) >= 1, "handover m1 inbox still shows own tt-track after prior TT m2 session");
  await ttOpen.click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  const ttHash = await page.evaluate(() => location.hash);
  ok(ttHash.includes("tt_emp=m1"), "native m1 tt-track routes m1 not stale last tt_emp m2");
  ok(!ttHash.includes("tt_emp=m2"), "native m1 tt-track does not inherit stale m2 employee");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_INBOX_ROUTE_QA, null, 2));
