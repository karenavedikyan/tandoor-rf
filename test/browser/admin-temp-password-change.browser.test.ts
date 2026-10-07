import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { chromium, type Browser, type Page } from "playwright";
import { buildSessionCookie } from "../../src/auth/cookie";
import { createSession } from "../../src/auth/session";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  confirmAdminProvisionDelivery,
  grantAdminAccess,
} from "../../src/access/user-provisioning";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEMP_PASSWORD = "TempPass123!AB";
const NEW_PASSWORD = "NewStrongPass123!";
const DESKTOP = { width: 1440, height: 900 };

describe("admin temp password browser flow", { concurrency: false }, () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl = ORIGIN;
  let databaseUrl = "";
  let tempUserId = "";
  let actorAdminId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    await closePool();
  });

  async function seedDatabase(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    await prepareDatabase(databaseUrl);
    const actor = await createTestUser({
      databaseUrl,
      email: "browser-provision-actor@example.com",
      password: "StrongPass123!",
      fullName: "Browser Provision Actor",
      role: "admin",
    });
    actorAdminId = actor.id;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await grantAdminAccess(client, {
        email: "browser-temp-admin@example.com",
        fullName: "Browser Temp Admin",
        actorUserId: actorAdminId,
        basis: "Browser E2E temp password provisioning",
        auditReviewConfirmed: true,
        temporaryPassword: TEMP_PASSWORD,
      });
      assert.equal(created.ok, true);
      await client.query("COMMIT");
      if (created.ok && created.mode === "created") {
        tempUserId = created.userId;
        await client.query("BEGIN");
        await confirmAdminProvisionDelivery(client, {
          userId: created.userId,
          actorUserId: actorAdminId,
          basis: "Browser E2E temp password provisioning",
        });
        await client.query("COMMIT");
      }
    } finally {
      client.release();
      await pool.end();
    }
  }

  async function startServer(): Promise<void> {
    setIntegrationEnv(databaseUrl, baseUrl);
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setIntegrationEnv(databaseUrl, baseUrl);
  }

  async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async function loginWithTempPassword(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#email", "browser-temp-admin@example.com");
    await page.fill("#password", TEMP_PASSWORD);
    await page.click("#login-button");
    await page.waitForURL(/\/change-password/, { timeout: 15000 });
  }

  it("login redirects to change password and then opens admin access", async () => {
    await seedDatabase();
    await resetPoolForTests();
    await startServer();

    const parallelSession = await createSession(tempUserId);
    const context = await browser.newContext({ viewport: DESKTOP, baseURL: baseUrl });
    const page = await context.newPage();
    await loginWithTempPassword(page);

    await page.fill("#current-password", TEMP_PASSWORD);
    await page.fill("#new-password", NEW_PASSWORD);
    await page.fill("#confirm-password", NEW_PASSWORD);
    await page.click("#change-password-button");
    await page.waitForURL(/\/admin\/access/, { timeout: 15000 });
    await page.waitForSelector("#admin-access-app:not(.clients-hidden)");

    const stale = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: baseUrl,
        Cookie: buildSessionCookie(parallelSession.token).split(";")[0] ?? "",
      },
    });
    assert.equal(stale.status, 401);

    await context.close();
    await stopServer();
  });
});
