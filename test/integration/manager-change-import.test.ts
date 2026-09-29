import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
} from "../helpers/onec-clients-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const OLD_MANAGER = "22222222-2222-4222-8222-222222222222";
const NEW_MANAGER = "55555555-5555-4555-8555-555555555555";
const CLIENT_GUID = "11111111-1111-4111-8111-111111111111";

function authHeaders(cookie: string): Record<string, string> {
  return { Origin: ORIGIN, Cookie: cookie };
}

function ftpEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
  };
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

describe("manager reassignment after import", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    const oldManager = await createTestUser({
      databaseUrl,
      email: "old-manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Old Manager",
      role: "manager",
    });
    const newManager = await createTestUser({
      databaseUrl,
      email: "new-manager@example.com",
      password: TEST_PASSWORD,
      fullName: "New Manager",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: oldManager.id,
      employeeId: OLD_MANAGER,
      confirmedByUserId: oldManager.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: newManager.id,
      employeeId: NEW_MANAGER,
      confirmedByUserId: newManager.id,
    });
  });

  after(async () => {
    await closePool();
  });

  it("moves client visibility when guid_manager changes", async () => {
    const initialBytes = buildClientsFileBytes([
      sampleClient({ guid_manager: OLD_MANAGER, name_manager: "Old Manager" }),
    ]);
    const initialHash = buildClientsFileSha256(JSON.parse(initialBytes.toString("utf8")));
    await runClientsImport({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-sha256", initialHash],
      fileBytes: initialBytes,
    });

    const oldCookie = await login("old-manager@example.com");
    const newCookie = await login("new-manager@example.com");
    const app = await loadApp();

    const oldBefore = await request(app)
      .get(`/api/clients/${CLIENT_GUID}`)
      .set(authHeaders(oldCookie));
    assert.equal(oldBefore.status, 200);

    const newBefore = await request(app)
      .get(`/api/clients/${CLIENT_GUID}`)
      .set(authHeaders(newCookie));
    assert.equal(newBefore.status, 404);

    const changedBytes = buildClientsFileBytes([
      sampleClient({ guid_manager: NEW_MANAGER, name_manager: "New Manager" }),
    ]);
    const changedHash = buildClientsFileSha256(JSON.parse(changedBytes.toString("utf8")));
    await runClientsImport({
      env: ftpEnv(databaseUrl),
      argv: ["--apply", "--expected-sha256", changedHash],
      fileBytes: changedBytes,
    });

    await resetPoolForTests();
    const appAfter = await loadApp();

    const oldAfter = await request(appAfter)
      .get(`/api/clients/${CLIENT_GUID}`)
      .set(authHeaders(oldCookie));
    assert.equal(oldAfter.status, 404);

    const newAfter = await request(appAfter)
      .get(`/api/clients/${CLIENT_GUID}`)
      .set(authHeaders(newCookie));
    assert.equal(newAfter.status, 200);
  });
});
