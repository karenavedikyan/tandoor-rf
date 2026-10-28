var TT_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker QA: " + s);
    checks.push(s);
  };
  page.on("dialog", (d) => d.accept());
  const open = async (id) => {
    const row = page.locator(`.tt-table [data-tt-open="${id}"]`);
    await row.waitFor({ state: "visible" });
    await row.click();
    await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  };
  const visibleRows = () => page.locator(".tt-table tbody tr:visible").count();
  const navHash = async (payload) => {
    const hash = payload.startsWith("#")
      ? payload
      : payload.includes("#")
        ? payload.slice(payload.indexOf("#"))
        : "#" + payload;
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
  };
  await page.goto("http://127.0.0.1:4317/#tan-tracker?role=manager");
  await page.reload();
  ok(await page.locator("#tt-root").count() === 1, "tan-tracker shell mounts");
  const mgrCount = await visibleRows();
  ok(mgrCount > 0 && mgrCount < 21, "manager registry scoped below full director set");
  await page.locator('[data-tt="search"]').pressSequentially("договор", { delay: 30 });
  ok((await page.locator('[data-tt="search"]').inputValue()) === "договор", "search keeps focus and full query");
  ok(await page.evaluate(() => document.activeElement?.matches('[data-tt="search"]')), "search input stays focused");
  await page.locator('[data-tt="reset-filters"]:visible').first().click();
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt="create-wizard"]').waitFor({ state: "visible" });
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  ok((await page.locator('[data-tt="form-error"]').textContent()).includes("переда"), "empty item rejected");
  await ttBackToList();
  await open("TT-2026-016");
  await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').first().click();
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Ожидает код"), "pending set");
  await ttOpenOtherActions();
  await page.locator('[data-tt="cancel-pending"]').click();
  await ttBackToList();
  await open("TT-2026-004");
  await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').first().click();
  await page.locator('[data-tt-pick="ext_01"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  if (await page.getByRole("button", { name: "Получить код", exact: true }).count())
    await page.getByRole("button", { name: "Получить код", exact: true }).click();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill("000000");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("Неверный"), "wrong code unchanged holder");
  await page.locator('button[data-tt="detail"]').click();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  if (await page.getByRole("button", { name: "Получить код", exact: true }).count())
    await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  ok(/^\d{6}$/.test(code), "six digit code on recipient screen");
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(code);
  const tlBefore = await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-004").timeline.length);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).dblclick();
  const tlAfter = await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-004").timeline.length);
  ok(tlAfter === tlBefore + 1, "single handoff appends timeline once");
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Сергей Приёмка"), "valid code updates holder");
  ok((await page.locator('[data-tt="access-denied"]').count()) === 0, "code confirm shows sender success not access denied");
  ok(
    (await page.locator('[data-tt="detail"]').textContent()).includes("Сергей"),
    "code confirm sender still reads successful handoff detail"
  );
  await ttOpenDetailDemo();
  await page.getByRole("button", { name: "Смотреть как текущий держатель (демо)", exact: true }).click();
  await page.locator('[data-tt="transfer"]').click();
  await page.locator('[data-tt="confirm-transfer"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="toggle-new"]').click();
  await page.locator('[data-tt-field="newName"]').fill("Внешний QA");
  await page.locator('[data-tt-field="newPhone"]').fill("79000000101");
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  if ((await page.locator('[data-tt="qr-host"]').count()) === 0) await page.locator('[data-tt="tab-qr"]').click();
  ok(await page.locator('[data-tt="qr-host"] svg').count() >= 1, "QR rendered on pending card");
  const oldQr = await page.locator('[data-tt="qr-host"]').getAttribute("data-payload");
  await page.locator('[data-tt="scan-qr-demo"]').click();
  ok(await page.locator('[data-tt="recipient-screen"]').count() === 1, "scan demo opens recipient");
  await page.locator('[data-tt="exit-recipient"]').click();
  await ttOpenOtherActions();
  await page.locator('[data-tt="change-pending"]').click();
  await page.locator('[data-tt="confirm-transfer"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="toggle-new"]').click();
  await page.locator('[data-tt-field="newName"]').fill("Смена QR");
  await page.locator('[data-tt-field="newPhone"]').fill("79000000102");
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  if ((await page.locator('[data-tt="qr-host"]').count()) === 0) await page.locator('[data-tt="tab-qr"]').click();
  const newQr = await page.locator('[data-tt="qr-host"]').getAttribute("data-payload");
  ok(oldQr !== newQr, "QR payload changes when recipient changes");
  await navHash(oldQr);
  await page.waitForFunction(() => location.hash.includes("tt_view=recipient"), null, { timeout: 10000 });
  await page.locator('[data-tt="recipient-screen"]').waitFor({ state: "visible", timeout: 10000 });
  const staleBody = await page.textContent("body");
  ok(staleBody.includes("устарело"), "stale QR shows old invitation");
  await navHash("#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-004");
  await page.locator("#tt-root").waitFor({ state: "visible" });
  if (await page.locator('[data-tt="act-holder"]').count()) {
    await ttOpenDetailDemo();
    await page.locator('[data-tt="act-holder"]').click();
  }
  if ((await page.locator('[data-tt="qr-host"]').count()) === 0) await page.locator('[data-tt="tab-qr"]').click();
  const usedQrPayload = await page.locator('[data-tt="qr-host"]').getAttribute("data-payload");
  await page.locator('[data-tt="scan-qr-demo"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить получение", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Смена QR"), "QR confirm handoff once");
  ok((await page.locator('[data-tt="access-denied"]').count()) === 0, "QR receipt does not access-deny verified external receiver");
  ok(await page.evaluate(() => document.body.classList.contains("tt-external-shell")), "external QR receiver stays external shell");
  ok(await page.locator(".sidebar").isHidden(), "external QR receiver hides sidebar");
  ok(await page.locator("#af-bell").isHidden(), "external QR receiver hides corporate bell");
  ok((await page.evaluate(() => location.hash)).includes("tt_act="), "external QR receiver keeps tt_act on new holder not staff m1");
  ok(
    await page.evaluate(
      () =>
        window.TanTrackerPrototype.state.employeeId === "m1" &&
        document.body.classList.contains("tt-external-shell") &&
        !location.hash.includes("tt_emp=")
    ),
    "external QR receiver keeps external shell without staff m1 URL profile"
  );
  const holderAfter = await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-004").holderId);
  const replayHash = usedQrPayload.startsWith("#") ? usedQrPayload : usedQrPayload.includes("#") ? usedQrPayload.slice(usedQrPayload.indexOf("#")) : "#" + usedQrPayload;
  await navHash(replayHash);
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  ok((await page.getByRole("button", { name: "Подтвердить получение", exact: true }).count()) === 0, "QR replay has no confirm");
  ok((await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-004").holderId)) === holderAfter, "QR replay blocked");
  await page.goto("http://127.0.0.1:4317/#clients?role=manager");
  ok(await page.locator("h1").filter({ hasText: "Мои клиенты" }).count() >= 1, "leave route restores clients heading");
  ok(await page.evaluate(() => !document.body.classList.contains("tt-recipient-shell")), "recipient shell class cleared");
  ok(await page.locator(".sidebar").isVisible(), "sidebar visible after leaving tan-tracker");
  await page.goto("http://127.0.0.1:4317/#tan-tracker?role=manager");
  await page.reload();
  if (await page.locator('[data-tt="reset-filters"]').count()) await page.locator('[data-tt="reset-filters"]').click();
  await open("TT-2026-003");
  const detailOverdue = await page.locator('[data-tt="detail"]').textContent();
  ok(detailOverdue.toLowerCase().includes("просроч"), "overdue transfer shows human overdue on detail (redesign tt52)");
  await ttBackToList();
  await open("TT-2026-002");
  if (await page.locator('[data-tt="act-holder"]').count()) {
    await ttOpenDetailDemo();
    await page.locator('[data-tt="act-holder"]').click();
  }
  const confirmCalls = await page.evaluate(() => {
    window.__ttConfirmCalls = 0;
    const orig = window.confirm;
    window.confirm = () => {
      window.__ttConfirmCalls += 1;
      return false;
    };
    return orig;
  });
  await page.getByRole("button", { name: "Завершить передачу", exact: true }).click();
  ok(await page.locator('[data-tt="complete-confirm"]').count() === 1, "complete opens inline confirm");
  ok(!(await page.locator('[data-tt="detail"]').textContent()).includes("Завершена"), "complete not immediate");
  await page.locator('[data-tt="complete-confirm"]').getByRole("button", { name: "Отмена", exact: true }).click();
  ok(await page.locator('[data-tt="complete-confirm"]').count() === 0, "complete cancel clears confirm");
  ok(
    (await page.evaluate(() => window.TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-002").status)) !== "completed",
    "complete cancel leaves order active"
  );
  await page.getByRole("button", { name: "Завершить передачу", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Завершена"), "complete transfer as holder");
  ok((await page.evaluate(() => window.__ttConfirmCalls)) === 0, "complete does not call native confirm");
  await page.evaluate((orig) => {
    if (orig) window.confirm = orig;
  }, confirmCalls);
  await ttOpenDemoSettings();
  await page.locator('[data-tt="employee"]').selectOption("m1");
  await ttBackToList();
  await open("TT-2026-001");
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  for (let i = 0; i < 5; i++) {
    await page.locator('[data-tt="code-input"]').fill(`00000${i}`);
    await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  }
  await page.locator('[data-tt="code-input"]').fill("000005");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("попыт"), "five wrong attempts exhaust code");
  await page.locator('button[data-tt="detail"]').click();
  await ttBackToList();
  await open("TT-2026-016");
  await page.locator('[data-tt="transfer"], [data-tt="transfer-final"]').first().click();
  await page.locator('[data-tt-pick="ext_02"]').click();
  await page.getByRole("button", { name: "Назначить получателя", exact: true }).click();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const code016 = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.getByRole("button", { name: "Истечь срок кода (демо)", exact: true }).click();
  await page.locator('[data-tt="code-input"]').fill(code016);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="code-error"]').textContent()).includes("истёк"), "expired code rejected");
  await page.locator('button[data-tt="detail"]').click();
  await ttBackToList();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const contrast = await page.locator('[data-tt-main-cta]').first().evaluate((el) => {
    const s = getComputedStyle(el);
    const parse = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(s.color);
    const bg = parse(s.backgroundColor);
    const L1 = lum(fg);
    const L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  });
  ok(contrast >= 4.5, "dark primary CTA contrast >= 4.5:1");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-tt="create-wizard"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("QR create QA");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await page.locator('[data-tt="recipient-choose"] [data-tt="create-new-recipient"]').click();
  await page.locator('[data-create-phase="recipient-new-name"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="newName"]').fill("Контакт QA99");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="recipient-new-phone"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="newPhone"]').fill("79000000099");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Создать передачу", exact: true }).click();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });
  if ((await page.locator('[data-tt="qr-host"]').count()) === 0) await page.locator('[data-tt="tab-qr"]').click();
  await page.locator('[data-tt="scan-qr-demo"]').click();
  ok(await page.locator('[data-tt="shown-code"]').count() === 0, "QR mode hides code until code path");
  await page.locator('[data-tt="exit-recipient"]').click();
  if ((await page.locator('[data-tt="qr-host"]').count()) > 0) await page.locator('[data-tt="tab-code"]').click();
  await ttOpenDetailDemo();
  await page.locator('[data-tt="open-recipient"]').click();
  await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  const codeNew = (await page.locator('[data-tt="shown-code"]').textContent()).trim();
  await page.locator('[data-tt="exit-recipient"]').click();
  await page.locator('[data-tt="enter-code"]').click();
  await page.locator('[data-tt="code-input"]').fill(codeNew);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  ok((await page.locator('[data-tt="detail"]').textContent()).includes("Контакт QA99"), "new contact code handoff");
  await ttBackToList();
  await page.setViewportSize({ width: 900, height: 650 });
  ok((await page.locator(".tt-table-scroll").evaluate((el) => el.scrollWidth > el.clientWidth)), "table overflows at 900px");
  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_QA, null, 2));
