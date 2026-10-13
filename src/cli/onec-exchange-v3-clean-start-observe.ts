#!/usr/bin/env node
import { getDatabaseUrl } from "../config";
import { observeCleanStartState } from "../onec-exchange-v3/clean-start-verify";
import { formatTargetDbForReport } from "../onec-exchange-v3/target-db-fingerprint";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || getDatabaseUrl();
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, code: "DATABASE_URL_REQUIRED", message: "DATABASE_URL required" }));
    process.exit(2);
  }

  const targetDbLabel = formatTargetDbForReport(databaseUrl);
  const observed = await observeCleanStartState(databaseUrl);
  if (!observed) {
    console.error(
      JSON.stringify({
        ok: false,
        targetDbLabel,
        code: "OBSERVE_FAILED",
        message:
          "Не удалось прочитать состояние (TLS, таймаут, отсутствие схемы v3 или onec_v3_exchange_state).",
      }),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetDbLabel,
        observed: {
          targetDb: {
            fingerprint: observed.targetDb.fingerprint,
            database: observed.targetDb.database,
          },
          legacyCleanStartCompletedAt: observed.legacyCleanStartCompletedAt,
          legacyCleanStartBundleFingerprint: observed.legacyCleanStartBundleFingerprint,
          lastBundleFingerprint: observed.lastBundleFingerprint,
          v3HoldingsCount: observed.v3HoldingsCount,
          v3LegalCount: observed.v3LegalCount,
          v3RetailCount: observed.v3RetailCount,
          v3EmployeeRosterCount: observed.v3EmployeeRosterCount,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
