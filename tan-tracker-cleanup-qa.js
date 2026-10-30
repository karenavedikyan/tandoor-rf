var TT_CLEANUP_QA = await (async () => {
  const checks = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ok = (v, label) => {
    if (!v) throw Error("Cleanup QA: " + label);
    checks.push(label);
  };
  const base = "http://127.0.0.1:4317";
  const getOrder = (id) => page.evaluate((key) =>
    JSON.stringify(TanTrackerPrototype.orders().find((o) => o.id === key)), id);
  const hash = async (role, id = "", extra = "", reload = false) => {
    await page.goto(`${base}/#tan-tracker?role=${role}&tt_screen=${id ? "detail" : "list"}${id ? `&tt_id=${id}` : ""}${extra}`);
    if (reload) await page.reload();
    await page.locator("#tt-root").waitFor({ state: "visible" });
    await page.waitForFunction(() => window.TtRegistryPersonal?.isHydrated?.());
    if (!id) {
      if (await page.locator('[data-tt="registry-view-main"]').count())
        await page.locator('[data-tt="registry-view-main"]').click();
      if (!extra.includes("tt_act=")) await ttWaitRegistryPersonalReady();
    }
  };
  const menu = async () => {
    const details = page.locator('[data-tt="detail-overflow"]');
    if (!(await details.evaluate((el) => el.open))) await details.locator(":scope > summary").click();
  };
  const confirm = () => page.locator('[data-tt="cleanup-confirm"]').click();
  const row = (id) => page.locator(`#tt-registry-body [data-tt-open="${id}"]`);
  const checkbox = (id) => page.locator(`[data-tt="cleanup-select"][value="${id}"]`);

  await hash("director", "", "", true);
  ok(!await page.locator('[data-tt="cleanup-open"]').count(), "director has no general cleanup rights");
  ok(await page.locator('[data-tt="cleanup-personal-open"]').isVisible(), "every ordinary user has personal archival entry");
  await hash("admin");
  ok((await page.evaluate(() => TanTrackerPrototype.effectiveProfile())).role === "admin", "distinct administrator role, no director promotion");
  const initialCount = await row("TT-2026-005").count();
  ok(initialCount === 1, "completed track initially in normal registry");
  const original = await getOrder("TT-2026-005");
  await page.locator('[data-tt="cleanup-open"]').click();
  ok(await page.locator('[data-tt="cleanup-confirm"]').isDisabled(), "empty selection cannot submit");
  await checkbox("TT-2026-005").check();
  await page.keyboard.press("Escape");
  ok(!await page.locator('[data-tt="cleanup-dialog"]').count(), "Escape cancels dialog");
  ok(await row("TT-2026-005").count() === 1, "cancel leaves registry untouched");
  await page.locator('[data-tt="cleanup-open"]').click();
  await checkbox("TT-2026-005").check();
  await page.locator('[data-tt="cleanup-reason"]').fill("Тестовый сценарий завершён");
  await confirm();
  ok(await row("TT-2026-005").count() === 0, "one track leaves normal registry");
  ok(await getOrder("TT-2026-005") === original, "archive leaves order, custody, status, files and timeline byte-for-byte unchanged");
  await page.locator('[data-tt="registry-view-general-archive"]').click();
  ok(await row("TT-2026-005").count() === 1, "track visible in separate general archive");
  await row("TT-2026-005").click();
  ok(await page.locator('[data-tt="archive-notice"]').isVisible(), "archived detail is visibly read-only");
  await page.locator('[data-tt="registry-archive-history"] summary').click();
  ok((await page.locator('[data-tt="registry-archive-history"]').innerText()).includes("Тестовый сценарий завершён"), "archive audit includes reason, time and actor");
  await page.locator('[data-tt="archive-notice"] [data-tt="cleanup-restore-one"]').click();
  await confirm();
  ok(!await page.locator('[data-tt="archive-notice"]').count(), "admin restores one track");
  ok(await getOrder("TT-2026-005") === original, "restoration preserves original order data");
  await page.locator('[data-tt="registry-archive-history"] summary').click();
  ok((await page.locator('[data-tt="registry-archive-history"]').innerText()).includes("Восстановлено"), "separate audit records restoration");

  await hash("admin");
  await page.locator('[data-tt="cleanup-open"]').click();
  const eligibleIds = await page.locator('[data-tt="cleanup-select"]:enabled').evaluateAll((els) => els.map((el) => el.value));
  ok(eligibleIds.length >= 2, "several completed/delivered tracks eligible");
  await checkbox(eligibleIds[0]).check();
  await checkbox(eligibleIds[1]).check();
  await confirm();
  await page.locator('[data-tt="registry-view-general-archive"]').click();
  ok(await page.locator("#tt-registry-body tr[data-tt-open]").count() === 2, "selected batch archives exactly two");
  await page.locator('[data-tt="cleanup-restore-open"]').click();
  await page.locator('[data-tt="cleanup-scope"][value="all"]').check();
  ok(await page.locator('[data-tt="cleanup-confirm"]').isDisabled(), "whole registry requires explicit acknowledgement");
  await page.locator('[data-tt="cleanup-ack"]').check();
  await confirm();
  await page.locator('[data-tt="registry-view-main"]').click();
  const activeBefore = await getOrder("TT-2026-001");
  await page.locator('[data-tt="cleanup-open"]').click();
  await page.locator('[data-tt="cleanup-scope"][value="all"]').check();
  ok((await page.locator('[data-tt="cleanup-summary"]').innerText()).includes("Будет пропущено"), "whole scope explicitly counts skipped active tracks");
  await page.locator('[data-tt="cleanup-ack"]').check();
  await confirm();
  ok(await getOrder("TT-2026-001") === activeBefore, "whole cleanup neither confirms nor cancels pending handoff");
  ok(await row("TT-2026-001").count() === 1, "active track stays visible");
  await page.locator('[data-tt="registry-view-general-archive"]').click();
  ok(await page.locator("#tt-registry-body tr[data-tt-open]").count() === eligibleIds.length, "whole scope archives all and only eligible tracks");
  await page.locator('[data-tt="cleanup-restore-open"]').click();
  await page.locator('[data-tt="cleanup-scope"][value="all"]').check();
  await page.locator('[data-tt="cleanup-ack"]').check();
  await confirm();

  await hash("manager", "TT-2026-005", "&tt_emp=m1");
  await menu();
  await page.locator('[data-tt="registry-archive"]').click();
  await ttBackToList();
  ok(!await row("TT-2026-005").count(), "personal archive hides completed track for actor m1");
  await page.locator('[data-tt="registry-view-archived"]').click();
  ok(await row("TT-2026-005").count() === 1, "personal archive keeps track and its history accessible");
  await hash("manager", "", "&tt_emp=m2");
  await page.locator('[data-tt="registry-view-main"]').click();
  ok(await row("TT-2026-005").count() === 1, "another user's normal list is unaffected by personal archive");
  await hash("manager", "", "&tt_emp=m1");
  await page.locator('[data-tt="registry-view-archived"]').click();
  await page.locator('[data-tt="cleanup-personal-restore"]').click();
  await checkbox("TT-2026-005").check();
  await confirm();
  await page.locator('[data-tt="registry-view-main"]').click();
  ok(await row("TT-2026-005").count() === 1, "ordinary user restores personal archived track");

  await hash("manager", "", "&tt_act=ext_03");
  await page.locator('[data-tt="external-home"]').waitFor();
  ok(!await page.locator('[data-tt="cleanup-open"]').count(), "external participant has no general cleanup rights");
  await page.locator('[data-tt="cleanup-personal-open"]').click();
  await checkbox("TT-2026-005").check();
  await confirm();
  ok(!await page.locator('[data-tt="external-home"] [data-tt-open="TT-2026-005"]').count(), "external user's own completed track can leave their working list");
  await page.locator('[data-tt="registry-view-archived"]').click();
  ok(await page.locator('[data-tt="external-home"] [data-tt-open="TT-2026-005"]').isVisible(), "limited external shell has its own archive without ordinary LK access");
  await page.locator('[data-tt="cleanup-personal-restore"]').click();
  await checkbox("TT-2026-005").check();
  await confirm();
  await page.locator('[data-tt="registry-view-main"]').click();

  await hash("manager", "TT-2026-001", "&tt_emp=m1", true);
  await menu();
  ok(await page.locator('[data-tt="cleanup-delete-one"]').isVisible(), "creator can delete before any first receipt");
  await page.locator('[data-tt="open-recipient"]').click();
  await page.waitForURL(/tt_view=recipient/);
  const oldRecipientUrl = page.url();
  await hash("manager", "TT-2026-001", "&tt_emp=m1");
  await menu();
  await page.locator('[data-tt="cleanup-delete-one"]').click();
  ok(await page.locator('[data-tt="cleanup-confirm"]').isDisabled(), "deletion needs exact typed confirmation");
  await page.locator('[data-tt="cleanup-cancel"]').first().click();
  ok(!!await getOrder("TT-2026-001"), "deletion cancellation preserves track");
  await menu();
  await page.locator('[data-tt="cleanup-delete-one"]').click();
  await page.locator('[data-tt="cleanup-delete-ack"]').fill("УДАЛИТЬ");
  await confirm();
  ok(!await getOrder("TT-2026-001"), "confirmed deletion removes demo order instead of archiving it");
  ok(!(await page.locator('[data-tt="registry-view-archived"]').innerText()).includes("(1)"), "deleted track is not added to personal archive");
  await page.goto(oldRecipientUrl);
  await page.locator('[data-tt="recipient-unavailable"]').waitFor();
  ok((await page.locator('[data-tt="recipient-unavailable"]').innerText()).includes("больше не действуют"), "old invitation link, QR destination and code screen fail closed");
  ok(!await page.locator('[data-tt="pick-channel"], [data-tt="shown-code"]').count(), "deleted invitation exposes no proof or code controls");

  await hash("director", "TT-2026-001", "", true);
  await menu();
  ok(!await page.locator('[data-tt="cleanup-delete-one"]').count(), "non-creator director cannot delete before receipt");
  await hash("admin", "TT-2026-001");
  await menu();
  ok(await page.locator('[data-tt="cleanup-delete-one"]').isVisible(), "admin includes creator's pre-receipt deletion capability");
  await hash("manager", "TT-2026-001", "&tt_emp=m1");
  // Negative fixture: a genuine receipt marker remains even after the item returns.
  await page.evaluate(() => {
    const o = TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-001");
    o.timeline.push({ at: Date.now(), from: "ext_01", to: "emp_m1", note: "Передано по подтверждённому коду", order: o.id });
    location.hash += "&qa_returned=1";
  });
  await page.locator('[data-tt="cleanup-delete-one"]').waitFor({state:"detached"});
  await menu();
  ok(!await page.locator('[data-tt="cleanup-delete-one"]').count(), "return to creator never restores deletion permission after first receipt");
  await hash("admin", "TT-2026-001");
  await menu();
  ok(!await page.locator('[data-tt="cleanup-delete-one"]').count(), "admin cannot bypass first-receipt prohibition");
  // Isolated synthetic fixtures, not production orders or clients. UI is used for
  // the actual destructive operation and its two independent confirmations.
  await page.evaluate(() => {
    const source = TanTrackerPrototype.orders().find((o) => o.id === "TT-2026-001");
    ["TT-2099-901", "TT-2099-902"].forEach((id) => {
      TanTrackerPrototype.orders().push({
        ...structuredClone(source), id, item: `QA: отменённая отправка ${id}`,
        createdById: "emp_ad1", holderId: "emp_ad1", pendingId: "emp_m1",
        finalRecipientId: "emp_m1", status: "waiting", code: null,
        activeInvitation: null, pastInvitations: [], handoffVer: 1, attachments: [],
        timeline: [{at:Date.now(),from:"emp_ad1",to:"emp_m1",note:"Создана передача"}],
      });
    });
  });
  await hash("admin");
  await page.locator('[data-tt="cleanup-open"]').click();
  await page.locator('[data-tt="cleanup-mode"][data-mode="delete"]').click();
  const eligibleDeleteIds = await page.locator('[data-tt="cleanup-select"]:enabled').evaluateAll((els) => els.map((el) => el.value));
  ok(eligibleDeleteIds.length > 0, "admin bulk deletion lists only confirmed pre-receipt candidates as eligible");
  await page.locator('[data-tt="cleanup-scope"][value="all"]').check();
  await page.locator('[data-tt="cleanup-delete-ack"]').fill("УДАЛИТЬ");
  ok(await page.locator('[data-tt="cleanup-confirm"]').isDisabled(), "bulk deletion needs both typed word and whole-registry acknowledgement");
  await page.locator('[data-tt="cleanup-ack"]').check();
  await confirm();
  const remaining = await page.evaluate(() => TanTrackerPrototype.orders().map((o) => o.id));
  ok(eligibleDeleteIds.every((id) => !remaining.includes(id)), "bulk deletion removes exactly eligible pre-receipt tracks");
  ok(remaining.includes("TT-2026-001") && remaining.includes("TT-2026-005"), "bulk deletion preserves received/returned and completed history");
  await hash("admin", "", "&as_person=ad1", true);
  ok(!await page.locator('[data-tt="cleanup-open"], [data-tt="cleanup-personal-open"]').count(), "read-only preview hides both general and personal mutation controls");
  // Forged UI control must still hit the role/read-only checks.
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.dataset.tt = "cleanup-open";
    b.textContent = "Injected cleanup";
    document.querySelector("#tt-content").append(b);
  });
  await page.getByRole("button", { name: "Injected cleanup" }).click();
  ok(!await page.locator('[data-tt="cleanup-dialog"]').count(), "injected button cannot mutate read-only preview");

  await hash("admin", "", "", true);
  await page.locator('[data-tt="cleanup-open"]').click();
  for (const [width, height, theme] of [[1440,900,"light"],[375,812,"light"],[320,640,"dark"],[1440,420,"dark"],[1440,900,"dark"]]) {
    await page.setViewportSize({width,height});
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme",t),theme);
    const fit = await page.locator('[data-tt="cleanup-dialog"]').evaluate((el) => {
      const r=el.getBoundingClientRect();
      const footer=el.querySelector("footer").getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,footerBottom:footer.bottom,w:innerWidth,h:innerHeight,overflow:el.scrollWidth>el.clientWidth+1};
    });
    ok(fit.left>=0 && fit.right<=fit.w+1 && fit.top>=0 && fit.bottom<=fit.h+1 && fit.footerBottom<=fit.h+1 && !fit.overflow, `${width}x${height} ${theme}: dialog and confirmation controls fit viewport`);
    await page.screenshot({path:`/tmp/tandoor-cleanup-${width}-${height}-${theme}.png`});
  }
  ok(errors.length===0, `no browser page errors (${errors.join("; ")})`);
  await page.keyboard.press("Escape");
  return {passed:checks.length,checks};
})();
console.log(JSON.stringify(TT_CLEANUP_QA,null,2));
