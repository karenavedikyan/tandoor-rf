var TT_DETAIL_TASK_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Tan-tracker detail task QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.locator('[data-tt="detail"]').waitFor({ state: "visible" });

  ok((await page.locator(".tt-detail-task-heading").textContent()).includes("Подтвердите передачу"), "pending holder task heading");
  ok((await page.locator(".tt-detail-task-receiver strong").count()) >= 1, "receiver name shown in task card");
  ok((await page.locator(".tt-detail-task-instructions").textContent()).includes("получить код"), "plain instructions");
  const order = await page.evaluate(() => {
    const task = document.querySelector('[data-tt="detail-task-card"]');
    const route = document.querySelector('[data-tt="detail-route-disclosure"]');
    if (!task || !route) return { ok: false };
    return { ok: task.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING };
  });
  ok(order.ok, "task card appears before route disclosure");

  ok(await page.locator('[data-tt="detail-route-disclosure"]').evaluate((el) => el.open), "route open by default on desktop (tt54)");
  ok(await page.locator('[data-tt="detail-attachments-disclosure"]').evaluate((el) => !el.open), "attachments disclosure closed initially");
  ok((await page.locator('[data-tt="history-panel"]').count()) >= 1, "desktop history panel always visible");
  ok((await page.locator('[data-tt="detail-facts"]').count()) >= 1, "desktop facts card in aside");
  ok((await page.locator(".tt-detail-sub").count()) === 0, "no inline comment block above task card");

  const longComment = "Длинный комментарий для проверки первого экрана · ".repeat(12);
  await page.evaluate(
    (text) => {
      const o = window.TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-001");
      if (o) {
        o.comment = text;
        o.qty = "3 коробки";
      }
    },
    longComment.trim()
  );
  await page.locator('[data-tt="enter-code"]').first().click();
  await page.locator('button[data-tt="detail"]').click();
  await page.locator('[data-tt="detail-task-card"]').waitFor({ state: "visible" });
  ok((await page.locator('[data-tt="detail-facts"]').textContent()).includes("Длинный комментарий"), "desktop facts card shows long comment");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`);
  await page.reload();
  await page.evaluate(
    (text) => {
      const o = window.TanTrackerPrototype.orders().find((x) => x.id === "TT-2026-001");
      if (o) {
        o.comment = text;
        o.qty = "3 коробки";
      }
    },
    longComment.trim()
  );
  await page.locator('[data-tt="enter-code"]').first().click();
  await page.locator('button[data-tt="detail"]').click();
  await page.locator('[data-tt="detail-task-card"]').waitFor({ state: "visible" });
  ok((await page.locator(".tt-detail-sub").count()) === 0, "long comment not inline above task on mobile");
  ok(await page.locator('[data-tt="detail-notes-disclosure"]').evaluate((el) => !el.open), "long comment hidden in closed notes disclosure");
  ok(!(await page.locator(".tt-detail-note-comment").isVisible()), "comment body not visible until expand");
  const taskBeforeNotes = await page.evaluate(() => {
    const task = document.querySelector('[data-tt="detail-task-card"]');
    const notes = document.querySelector('[data-tt="detail-notes-disclosure"]');
    return !!(task && notes && task.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  ok(taskBeforeNotes, "task card precedes notes disclosure with long comment");

  const heroEnter = page.locator('[data-tt="handoff-panel"] [data-tt="enter-code"]').first();
  await heroEnter.waitFor({ state: "visible" });
  const hit = await heroEnter.evaluate((btn) => {
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === btn || btn.contains(el);
  });
  ok(hit, "375px enter-code hit-test on first screen");
  const box = await heroEnter.boundingBox();
  ok(box && box.y + box.height <= 812, "375px primary in viewport");

  await page.evaluate(() => document.getElementById("af-required-reminder")?.remove());
  await page.locator('[data-tt="detail-notes-disclosure"] summary').click();
  ok((await page.locator(".tt-detail-note-comment").textContent()).includes("Длинный комментарий"), "expand notes reveals full long comment");
  ok((await page.locator(".tt-detail-note-value").textContent()).includes("3 коробки"), "expand notes shows qty");

  await page.locator('[data-tt="detail-attachments-disclosure"] summary').click();
  ok((await page.locator(".tt-att-compact .tt-att-action").count()) >= 1, "attachments expand with action chips");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  ok(await page.locator('[data-tt="handoff-panel"] [data-tt="enter-code"]').isVisible(), "dark theme primary visible");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-002`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-task-readonly"]').textContent()).includes("Только просмотр"), "non-holder info task");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 0, "non-holder no enter-code");

  await page.goto(`${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-009`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-completed"]').count()) >= 1, "completed terminal copy");
  ok((await page.locator('[data-tt="enter-code"]').count()) === 0, "completed no handoff");

  await page.goto(`${base}/#tan-tracker?role=coordinator&tt_emp=c1&tt_id=TT-2026-012`);
  await page.reload();
  ok((await page.locator('[data-tt="detail-primary-actions"] .tt-primary').count()) >= 1, "relay holder primary choose-recipient action");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(TT_DETAIL_TASK_QA, null, 2));
