import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { Pool } from "pg";
import { chromium, type Browser } from "playwright";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, prepareDatabase, setIntegrationEnv, getIntegrationDatabaseUrl } from "../helpers/test-db";

let server: Server, browser: Browser, db: Pool, baseUrl: string;
const PASS = "SyntheticOldPassword123!";
describe("employee access rollout browser", () => {
  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url); await prepareDatabase(url);
    await resetPoolForTests(); db = new Pool({ connectionString: url, max: 1 });
    await createTestUser({ databaseUrl: url, email: "rollout-ui-admin@example.test", fullName: "Admin UI", role: "admin", password: PASS });
    await db.query("UPDATE onec_v3_exchange_state SET last_bundle_fingerprint=$1 WHERE id=1", ["c".repeat(64)]);
    await db.query(`INSERT INTO onec_v3_legal_entities
      (guid_client,name_client,type_category,managers,other_fields,last_source_sha256)
      VALUES($1,'Manual director scope test','{}','{}','{}','synthetic')`, [randomUUID()]);
    const { createApp } = await import("../../src/server");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.on("listening", resolve));
    baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    process.env.APP_ORIGIN = baseUrl;
    browser = await chromium.launch({ headless: true });
  });
  after(async () => {
    await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve()));
    await db?.end(); await closePool();
  });
  it("downloads before activation, no DOM password leak; manual director has scoped role after password change", async () => {
    const out = "/home/user/workspace/tandoor-qa/browser-regression/employee-access-rollout";
    await mkdir(out, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(baseUrl + "/login");
    await page.fill("#email", "rollout-ui-admin@example.test"); await page.fill("#password", PASS);
    await page.click("#login-form button[type=submit]"); await page.waitForURL(url => url.pathname === "/clients");
    await page.goto(baseUrl + "/admin/access"); await page.waitForSelector("#admin-access-app:not(.clients-hidden)");
    const plan = { basis: "Synthetic UI test approval for manual director", entries: [{
      email: "rollout-ui-director@example.test", fullName: "Synthetic director", role: "director",
    }] };
    await page.locator("summary").filter({ hasText: "Ввести подготовленный" }).click();
    await page.fill("#rollout-plan", JSON.stringify(plan));
    const downloadPromise = page.waitForEvent("download");
    await page.click("#rollout-prepare");
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith(".md"));
    const text = await readFile((await download.path())!, "utf8");
    const metadata = JSON.parse(text.match(/^<!-- tandoor-rollout:(.+) -->/)![1]!);
    const password = text.split("|").at(-2)!.trim();
    assert.equal((await db.query("SELECT 1 FROM users WHERE email='rollout-ui-director@example.test'")).rowCount, 0);
    assert.ok(!(await page.locator("body").innerText()).includes(password));
    assert.ok(!(await page.locator("body").innerText()).includes(metadata.receipt));
    assert.equal(await page.locator("#rollout-activate").isDisabled(), true);
    await page.check("#rollout-confirm"); await page.click("#rollout-activate");
    await page.waitForFunction(() => document.getElementById("rollout-status")?.textContent?.includes("активированы: 1"));
    await page.waitForFunction(() => (document.getElementById("rollout-activate") as HTMLButtonElement)?.disabled);
    assert.equal((await db.query("SELECT password_must_change FROM users WHERE email='rollout-ui-director@example.test'")).rows[0].password_must_change, true);
    await page.locator("[data-theme-toggle]").click();
    await page.screenshot({ path: out + "/admin-dark.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForFunction(() => document.getElementById("legacy-sidebar")!.getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: out + "/admin-dark-mobile.png" });
    await context.close();

    const directorContext = await browser.newContext();
    const d = await directorContext.newPage();
    await d.goto(baseUrl + "/login");
    await d.fill("#email", plan.entries[0]!.email); await d.fill("#password", password);
    await d.click("#login-form button[type=submit]"); await d.waitForURL("**/change-password");
    await d.fill("#current-password", password);
    await d.fill("#new-password", "SyntheticChangedPassword456!");
    await d.fill("#confirm-password", "SyntheticChangedPassword456!");
    await d.click("#change-password-form button[type=submit]"); await d.waitForURL(url => url.pathname === "/clients");
    const clients = await d.request.get(baseUrl + "/api/clients/v3/list?entity=legal&view=all");
    assert.equal(clients.status(), 200);
    assert.ok(JSON.stringify(await clients.json()).includes("Manual director scope test"));
    assert.equal((await d.request.get(baseUrl + "/api/admin/access/overview")).status(), 403);
    await d.goto(baseUrl + "/access");
    await d.waitForSelector("#access-workspace-app:not(.clients-hidden)");
    assert.ok((await d.locator(".legacy-sidebar").innerText()).includes("Назначения ассистентам"));
    assert.deepEqual(errors, []);
    await directorContext.close();
  });
});
