import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { seedAssignmentQa, QA_PASSWORD } from "../helpers/assistant-assignment-fixtures";

const ORIGIN = "http://127.0.0.1:3317";
const SCREENSHOTS = process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join(process.cwd(), "test-results", "screenshots");
describe("assignment leadership browser: synthetic local database only", { concurrency: false }, () => {
  let browser: Browser, server: Server, pool: Pool;
  let users: Awaited<ReturnType<typeof seedAssignmentQa>>;
  const errors: string[] = [];
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    users = await seedAssignmentQa(url, ORIGIN);
    await linkUserToEmployee({
      databaseUrl: url, userId: users.rop!.id,
      employeeId: "77777777-7777-4777-8777-777777777777", confirmedByUserId: users.admin!.id,
    });
    pool = new Pool({ connectionString: url });
    await pool.query(
      "INSERT INTO rop_team_members(rop_user_id,member_user_id,basis,created_by_user_id) VALUES($1,$2,'Browser QA',$3)",
      [users.rop!.id, users.manager!.id, users.admin!.id],
    );
    await resetPoolForTests();
    server = createServer(createApp());
    await new Promise<void>(resolve => server.listen(3317, "127.0.0.1", resolve));
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
      headless: true, args: ["--no-sandbox"],
    });
  });
  after(async () => {
    await browser?.close();
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    await pool?.end();
    await closePool();
  });
  async function pageFor(who: string) {
    const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 950 } });
    const login = await context.request.post("/api/auth/login", {
      headers: { Origin: ORIGIN }, data: { email: users[who]!.email, password: QA_PASSWORD },
    });
    assert.equal(login.status(), 200, await login.text());
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", dialog => void dialog.accept("Основание: локальная браузерная проверка"));
    await page.goto("/access");
    await page.locator("#aa-list-box").waitFor();
    return page;
  }
  async function createAndDecide(page: Page, manager: string) {
    await page.locator('[data-aa="new"]').click();
    await page.locator("#aa-manager").selectOption(users[manager]!.id);
    await page.locator("#aa-assistant").selectOption(users.assistant!.id);
    await page.locator("#aa-picker input[data-pick]").first().check();
    await page.locator("#aa-basis").fill("Локальная проверка назначения руководителем");
    await page.locator('#aa-assignment-form button[type="submit"]:not([data-draft])').click();
    await page.locator('[data-aa="approve"]').waitFor();
    await decision(page, "approve");
    await page.locator('[data-aa="revoke"]').waitFor();
    await page.locator('[data-aa="change"]').click();
    await page.locator("#aa-basis").fill("Проверка изменения условий руководителем");
    await page.locator('#aa-assignment-form button[type="submit"]:not([data-draft])').click();
    await page.locator('[data-aa="approve_change"]').waitFor();
    await decision(page, "approve_change");
    await page.locator('[data-aa="revoke"]').waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForFunction(() => (document.querySelector("#legacy-sidebar")?.getBoundingClientRect().right ?? 0) <= 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, "page should not overflow horizontally at 375px");
    await page.screenshot({ path: path.join(SCREENSHOTS, `assignment-${manager}-mobile.png`), animations: "disabled" });
    await decision(page, "revoke");
    await page.waitForFunction(() => !document.querySelector('[data-aa="revoke"]'));
    await page.setViewportSize({ width: 1440, height: 950 });
  }
  async function decision(page: Page, action: string) {
    await page.locator(`[data-aa="${action}"]`).click();
    await page.locator("#aa-decision-reason").fill("Основание: локальная браузерная проверка");
    await page.locator('#aa-decision button[type="submit"]').click();
    await page.locator("#aa-decision").waitFor({ state: "hidden" });
  }
  it("director completes foreign-team creation, approval, change, revocation and journal on desktop/mobile", async () => {
    const page = await pageFor("director");
    await createAndDecide(page, "manager2");
    await page.locator('[data-aa="activity"]').click();
    await page.waitForFunction(() => document.querySelector("#aa-list-box h2")?.textContent === "Журнал распределения");
    await page.waitForFunction(() => document.querySelector("#aa-list-box")?.textContent?.includes("Тест: Директор"));
    await page.context().close();
  });
  it("ROP sees only current-team managers and completes the same operations for own team", async () => {
    const page = await pageFor("rop");
    await page.locator('[data-aa="new"]').click();
    const ids = await page.locator("#aa-manager option").evaluateAll(els => els.map(el => (el as HTMLOptionElement).value));
    assert.ok(ids.includes(users.manager!.id));
    assert.ok(!ids.includes(users.manager2!.id));
    await page.locator('[data-aa="abandon"]').click();
    await createAndDecide(page, "manager");
    await page.context().close();
  });
  it("assistant remains read-only and no uncaught JS errors occurred", async () => {
    const page = await pageFor("assistant");
    assert.equal(await page.locator('[data-aa="new"]').count(), 0);
    assert.equal(await page.locator('[data-aa="activity"]').count(), 0);
    assert.deepEqual(errors, []);
    await page.context().close();
  });
});
