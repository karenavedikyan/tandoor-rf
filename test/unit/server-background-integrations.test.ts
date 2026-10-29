import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { shouldSkipBackgroundIntegrations } from "../../src/shared/tan-tracker-user-test-runtime";

describe("server background integration startup", () => {
  const saved = { ...process.env };

  after(() => {
    process.env = saved;
  });

  it("uses independent 1C and Tanbot startup chains after listen", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/server.ts"), "utf8");
    assert.match(src, /void runOneCBackgroundIntegrationStartup\(pool\)\.catch/);
    assert.match(src, /void runTanbotBackgroundIntegrationStartup\(pool\)\.catch/);
    const oneCBlock = src.slice(
      src.indexOf("export async function runOneCBackgroundIntegrationStartup"),
      src.indexOf("export async function runTanbotBackgroundIntegrationStartup"),
    );
    const tanbotBlock = src.slice(
      src.indexOf("export async function runTanbotBackgroundIntegrationStartup"),
      src.indexOf("export function scheduleBackgroundIntegrationsAfterListen"),
    );
    assert.doesNotMatch(oneCBlock, /Tanbot|tanbot/);
    assert.doesNotMatch(tanbotBlock, /runOneDiagnosticJob|drainPendingImportJobs|startNightlyExchangeScheduler/);
  });

  it("runTanbotBackgroundIntegrationStartup resolves with Telegram outbox disabled", async () => {
    process.env.TT_USER_TEST_ENV = "false";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "false";
    const { runTanbotBackgroundIntegrationStartup } = await import("../../src/server");
    await assert.doesNotReject(() =>
      runTanbotBackgroundIntegrationStartup({} as import("pg").Pool),
    );
  });

  it("shouldSkipBackgroundIntegrations blocks tt56 test stand workers", () => {
    process.env.TT_USER_TEST_ENV = "true";
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/tandoor_rf_tt56_user_test";
    process.env.ONEC_NIGHTLY_EXCHANGE_ENABLED = "false";
    assert.equal(shouldSkipBackgroundIntegrations(), true);
  });
});
