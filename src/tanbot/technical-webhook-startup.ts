import type { Pool } from "pg";
import { isTanTrackerUserTestEnvRequested } from "../shared/tan-tracker-user-test-env";
import { loadTanbotTelegramConfig } from "../tanbot-telegram/config";
import { loadTanbotTelegramStage2Config } from "../tanbot-telegram/stage2-config";
import { loadTanbotMaxConfig } from "../tanbot-max/config";
import { loadTanbotMaxStage2Config } from "../tanbot-max/stage2-config";
import { createMaxDispatcher, readMaxTlsCaBundle, wrapFetchWithMaxTls } from "../tanbot-max/tls-fetch";
import { LEGACY_BOT_ORIGIN, migrateMaxWebhook, migrateTelegramWebhook, type MigrationResult } from "./technical-webhook-migration";

export function isApprovedTechnicalWebhookRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" && env.APP_ORIGIN?.replace(/\/$/, "") === LEGACY_BOT_ORIGIN
    && !isTanTrackerUserTestEnvRequested(env);
}

/**
 * Owner-approved desired webhook addresses for app258307. No public management
 * route or token extraction. Once switched, later starts perform read-only
 * verification; unknown/empty registrations are never taken over.
 */
export async function ensureApprovedTechnicalWebhooks(
  pool: Pool, env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isApprovedTechnicalWebhookRuntime(env)) {
    if (env.NODE_ENV === "production") console.log("Technical bot webhook: runtime not approved; no changes");
    return;
  }
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked", [902_451_002],
    )).rows[0]?.locked === true;
    if (!locked) return;
    const log = (result: MigrationResult): void => {
      console.log(`Technical bot webhook: ${JSON.stringify(result)}`);
    };
    const telegram = loadTanbotTelegramConfig(env);
    const telegramStage = loadTanbotTelegramStage2Config(env);
    if (telegram.ok && telegramStage.ok && telegramStage.config.webhookEnabled && telegramStage.config.webhookSecret) {
      log(await migrateTelegramWebhook({
        token: telegram.config.botToken, secret: telegramStage.config.webhookSecret,
        expectedUsername: telegram.config.expectedUsername,
      }));
    } else {
      log({ channel: "telegram", status: "skipped", code: "CONFIG_NOT_ENABLED" });
    }
    const max = loadTanbotMaxConfig(env);
    const maxStage = loadTanbotMaxStage2Config(env);
    if (max.ok && maxStage.ok && maxStage.config.webhookEnabled && maxStage.config.webhookSecret) {
      const dispatcher = createMaxDispatcher(readMaxTlsCaBundle(env));
      try {
        log(await migrateMaxWebhook({
          token: max.config.botToken, secret: maxStage.config.webhookSecret,
          expectedUsername: max.config.expectedUsername,
        }, wrapFetchWithMaxTls(fetch, dispatcher)));
      } finally { await dispatcher?.close(); }
    } else {
      log({ channel: "max", status: "skipped", code: "CONFIG_NOT_ENABLED" });
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [902_451_002]).catch(() => undefined);
    client.release();
  }
}
