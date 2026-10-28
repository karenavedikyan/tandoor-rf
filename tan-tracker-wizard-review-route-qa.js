var TT_WIZ_REVIEW_ROUTE_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker wizard review route QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1`);
  await page.reload();
  await page.locator("#tt-root").waitFor({ state: "visible" });

  const senderName = await page.evaluate(() => {
    const p = window.TanTrackerPrototype;
    const c = p.contacts().find((x) => x.employeeId === p.state.employeeId);
    return c?.name || "";
  });

  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt-field="item"]').fill("Route nav direct");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-tt="attach-input"]').setInputFiles({
    name: "route.png",
    mimeType: "image/png",
    buffer: Buffer.from(png1x1, "base64"),
  });
  await page.locator('[data-tt="attach-list"] .tt-att-item').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await ttOpenRecipientList();
  await page.locator(".tt-wizard-contact").filter({ hasText: "Сергей Приёмка" }).first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });

  ok((await page.locator('[data-tt="review-route-nav"]').count()) === 1, "review route navigator present");
  ok((await page.locator(".tt-wizard-route-plan-note").textContent()).includes("ещё не создана"), "planned route note not completion");
  ok((await page.locator('[data-tt="route-stop-sender"]').count()) === 1, "sender stop");
  ok((await page.locator('[data-tt="route-stop-final"]').count()) === 1, "final stop direct");
  ok((await page.locator(".tt-wizard-route-scheme--direct .tt-wizard-route-stop").count()) === 2, "direct two person stops in ol");
  ok((await page.locator('[data-tt="route-stop-sender"]').textContent()).includes("Отправитель"), "sender role label");
  ok((await page.locator('[data-tt="route-stop-sender"]').textContent()).includes("Вы"), "sender you label");
  if (senderName) ok((await page.locator('[data-tt="route-stop-sender"]').textContent()).includes(senderName.split(" ")[0]), "actual sender name from actor");
  ok((await page.locator('[data-tt="route-stop-final"]').textContent()).includes("Получатель"), "final role label");
  ok((await page.locator('[data-tt="review-handoff"] [data-tt="create-edit-relay"]').count()) === 1, "direct relay CTA on final area");

  await page.setViewportSize({ width: 375, height: 812 });
  ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    "375px review route no horizontal scroll"
  );

  await page.locator('[data-tt="create-edit-relay"]').click();
  await page.locator('[data-tt-pick="emp_c1"]').click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-wizard-route-scheme--relay .tt-wizard-route-stop").count()) === 3, "relay three stops");
  ok((await page.locator('[data-tt="review-handoff"]').textContent()).includes("Посредник"), "intermediary role");
  ok((await page.locator('[data-tt="review-handoff"]').textContent()).includes("Наталья"), "relay person name");
  ok((await page.locator('[data-tt="route-stop-final"]').textContent()).includes("Сергей"), "final unchanged with relay");

  await page.setViewportSize({ width: 1440, height: 900 });
  const relayLayout = await page.evaluate(() => {
    const scheme = document.querySelector(".tt-wizard-route-scheme--relay");
    if (!scheme || getComputedStyle(scheme).flexDirection !== "column") return { ok: false, why: "not-column" };
    const person =
      scheme.querySelector('[data-tt="review-handoff"] .tt-wizard-route-person') ||
      scheme.querySelector(".tt-wizard-route-person");
    const name = person?.querySelector(".tt-wizard-review-person-name");
    const phone = person?.querySelector(".tt-wizard-review-person-phone");
    const nr = name?.getBoundingClientRect();
    const pr = phone?.getBoundingClientRect();
    const stacked = !!(nr && pr && pr.top >= nr.bottom - 2);
    const tops = [...scheme.querySelectorAll(".tt-wizard-route-stop")].map((s) => s.getBoundingClientRect().top);
    const verticalStops = tops.length === 3 && tops.every((t, i) => i === 0 || t >= tops[i - 1] - 2);
    const arrows = [...scheme.querySelectorAll(".tt-wizard-route-connector .tt-wizard-route-arrow")];
    const verticalArrows = arrows.length === 2 && arrows.every((a) => {
      const r = a.getBoundingClientRect();
      return r.height >= 18 && r.width <= 4;
    });
    return { ok: stacked && verticalStops && verticalArrows };
  });
  ok(relayLayout.ok, "1440px relay route vertical stack name/phone lines connected");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  ok(await page.locator('[data-tt="review-route-nav"]').isVisible(), "dark theme route nav visible");

  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Route nav direct"), "relay create completes");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_WIZ_REVIEW_ROUTE_QA, null, 2));
