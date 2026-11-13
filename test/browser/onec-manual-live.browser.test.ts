import assert from "node:assert/strict";
import http from "node:http";
import { mkdir } from "node:fs/promises";
import { before, after, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { prepareDatabase, getIntegrationDatabaseUrl, setIntegrationEnv, createTestUser } from "../helpers/test-db";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { manualFixture, fixtureGuid } from "../helpers/onec-manual-fixtures";
import { setImportJobWorkerTestHooks } from "../../src/onec-import/worker-scheduler";
const enabled = process.env.ONEC_LIVE_BROWSER_TEST === "true";
describe("manual 1C full-stack browser: real local PostgreSQL, no API mocks", { skip: !enabled }, () => {
  let browser: Browser, server: http.Server, base: string;
  const dir = "/home/user/workspace/onec-manual-qa";
  const client = { guid_client: fixtureGuid(601), name_client: "Проверка клиента", inn: "1234567890" };
  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url);
    await prepareDatabase(url); await resetPoolForTests(); await mkdir(dir, { recursive: true });
    Object.assign(process.env, { ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "gw.toopatch.ru", ONEC_FTP_PORT: "21",
      ONEC_FTP_USER: "test", ONEC_FTP_PASSWORD: "local-test-only", ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_SECURITY: "plain" });
    await createTestUser({ databaseUrl: url, email: "live-onec@test.local", password: "StrongPass123!", fullName: "Тестовый администратор", role: "admin" });
    const app = (await import("../../src/server")).createApp();
    server = http.createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as import("net").AddressInfo).port}`;
    process.env.APP_ORIGIN = base;
    browser = await chromium.launch({ headless: true, channel: "chromium" });
  });
  after(async () => {
    setImportJobWorkerTestHooks(undefined); await browser?.close();
    if (server) await new Promise<void>(r => server.close(() => r())); await closePool();
  });
  it("updates from button, opens safe variants/report, filters, clears corrected warnings at 375px", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", dialog => { void dialog.accept(); });
    const login = await context.request.post(base + "/api/auth/login", {
      headers: { Origin: base }, data: { email: "live-onec@test.local", password: "StrongPass123!" },
    }); assert.equal(login.status(), 200);
    setImportJobWorkerTestHooks({ regularUpdateExecution: { manualFiles: manualFixture({
      clients: [client, { ...client, inn: "9999999999" }],
    }) } });
    await page.goto(base + "/clients");
    await page.locator("#onec-update-panel summary").click();
    await page.locator("#onec-update-button").click();
    await page.locator("#onec-update-status").filter({ hasText: "Обновлено с замечаниями" }).waitFor({ timeout: 20000 });
    await page.goto(base + "/clients?v3mode=1&v3entity=legal&v3view=all");
    await page.locator(".onec-quality summary").first().waitFor();
    await page.locator("#onec-quality-filter").check();
    await page.waitForURL(/qualityOnly=1/);
    await page.locator(".onec-quality summary").first().click();
    assert.ok((await page.locator(".onec-quality").first().innerText()).includes("9999999999"));
    await page.screenshot({ path: dir + "/live-list-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForFunction(() => document.querySelector("#legacy-sidebar")!.getBoundingClientRect().right <= 0);
    await page.locator(".x13-client-card .onec-quality summary").first().click();
    await page.screenshot({ path: dir + "/live-list-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#onec-update-panel summary").click();
    await page.locator("#onec-open-report").click();
    await page.getByRole("dialog", { name: "Построчный отчёт обновления 1С" }).waitFor();
    await page.getByRole("dialog").getByText("Исходные данные 1С", { exact: true }).waitFor();
    await page.locator("[data-status]").filter({ hasText: "Всего строк" }).waitFor();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "На весь экран", exact: true }).click();
    await page.locator("#v3-focus-host .onec-quality summary").first().waitFor();
    await page.locator("#v3-focus-host .onec-quality summary").first().click();
    await page.screenshot({ path: dir + "/live-list-focus.png" });
    await page.locator("#v3-focus-exit").click();
    setImportJobWorkerTestHooks({ regularUpdateExecution: { manualFiles: manualFixture({ clients: [client] }) } });
    await page.locator("#onec-update-button").click();
    await page.locator("#onec-update-status").filter({ hasText: "Обновлено. Замечаний не обнаружено." }).waitFor({ timeout: 20000 });
    await page.goto(base + "/clients/" + fixtureGuid(601) + "?v3Entity=legal");
    await page.locator('[data-testid="v3-detail-card"]').waitFor();
    assert.equal(await page.locator(".onec-quality").count(), 0);
    assert.deepEqual(errors, []); await context.close();
  });
});
