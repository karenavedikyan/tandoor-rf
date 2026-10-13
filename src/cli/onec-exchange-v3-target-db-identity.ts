#!/usr/bin/env node
import { getDatabaseUrl } from "../config";
import { formatTargetDbForReport } from "../onec-exchange-v3/target-db-fingerprint";
import {
  resolveTargetDbIdentityFromUrl,
  TargetDbIdentityError,
} from "../onec-exchange-v3/target-db-identity";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || getDatabaseUrl();
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, code: "DATABASE_URL_REQUIRED", message: "DATABASE_URL required" }));
    process.exit(2);
  }

  const targetDbLabel = formatTargetDbForReport(databaseUrl);

  try {
    const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
    console.log(
      JSON.stringify(
        {
          ok: true,
          targetDbLabel,
          identity: {
            fingerprint: identity.fingerprint,
            database: identity.database,
            serverHost: identity.serverHost,
            serverPort: identity.serverPort,
            systemIdentifier: identity.systemIdentifier,
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    if (error instanceof TargetDbIdentityError) {
      console.error(
        JSON.stringify({
          ok: false,
          targetDbLabel,
          code: error.code,
          message: error.message,
          timeoutKind: error.timeoutKind,
        }),
      );
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : "Target DB identity failed";
    console.error(JSON.stringify({ ok: false, targetDbLabel, code: "TARGET_DB_IDENTITY_UNAVAILABLE", message }));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
