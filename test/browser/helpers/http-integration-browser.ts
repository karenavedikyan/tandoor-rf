import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { Pool } from "pg";
import { chromium, type Browser } from "playwright";
import { closePool, resetPoolForTests } from "../../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../../helpers/test-db";

export type BrowserHttpFixture = {
  browser: Browser;
  baseUrl: string;
  server: http.Server;
  databaseUrl: string;
  password: string;
};

export async function startBrowserHttpFixture(opts: {
  attachmentsDir: string;
  extraEnv?: Record<string, string>;
}): Promise<BrowserHttpFixture> {
  const databaseUrl = getIntegrationDatabaseUrl();
  const password = "StrongPass123!";
  setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
  await prepareDatabase(databaseUrl);
  await resetPoolForTests();

  process.env.TT_ATTACHMENTS_BACKEND = "postgres";
  process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), opts.attachmentsDir);
  process.env.TANBOT_TELEGRAM_ENABLED = "false";
  process.env.ONEC_FTP_ENABLED = "false";
  process.env.BITRIX24_ENABLED = "false";
  if (opts.extraEnv) {
    for (const [k, v] of Object.entries(opts.extraEnv)) process.env[k] = v;
  }

  const { createApp } = await import("../../../src/server");
  const server = http.createServer(createApp());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.APP_ORIGIN = baseUrl;

  // Requires Playwright browser install in the environment (e.g. chromium); not an app lifecycle workaround.
  const browser = await chromium.launch({ headless: true, channel: "chromium" });

  return { browser, baseUrl, server, databaseUrl, password };
}

export async function stopBrowserHttpFixture(fixture: BrowserHttpFixture): Promise<void> {
  await fixture.browser.close();
  await closePool();
  await new Promise<void>((resolve, reject) => {
    fixture.server.close((err) => (err ? reject(err) : resolve()));
  });
  delete process.env.TT_ATTACHMENTS_BACKEND;
}

export async function seedTanTrackerBrowserUsers(databaseUrl: string, password: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await createTestUser({
      databaseUrl,
      email: "tt-browser-admin@test.local",
      password,
      fullName: "Browser Admin",
      role: "admin",
    });
    await createTestUser({
      databaseUrl,
      email: "tt-browser-fresh@test.local",
      password,
      fullName: "Browser Fresh Recipient",
      role: "manager",
    });
  } finally {
    await pool.end();
  }
}
