import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { withReadOnlyPreflightSession } from "../matched-only/production/read-only-session";
import { Pool } from "pg";
import { createPgPoolOptions } from "../../config/pg-ssl";
import { assertSchema047048Ready } from "./schema-047-048";
import { verifyCatalogPin } from "./catalog-pin";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import {
  APP_RELEASE_REF_FOR_COMPATIBILITY,
  EXPECTED_SOURCE_FILES,
  EXPECTED_TARGET_DB_FINGERPRINT,
  SEPTEMBER_2026_SALE_MONTH_ISO,
  TIMEWEB_APP_ID,
  TIMEWEB_DB_ID,
} from "./scope-pins";
import { verifySourceFilePin, verifyMatchedCountsFromSources } from "./source-pins";
import { readFile } from "node:fs/promises";
import { assertPreflightDatabaseUrl } from "./operator-guard";

export type SeptemberPreflightReport = {
  v: 1;
  mode: "preflight";
  saleMonth: string;
  target: {
    timewebAppId: number;
    timewebDbId: number;
    fingerprint: string;
    fingerprintOk: boolean;
  };
  appReleaseRef: string;
  schema047048Ok: boolean;
  catalog: { ok: boolean; count?: number; sha256?: string; code?: string };
  sourcePins: Record<string, { ok: boolean; code?: string }>;
  beforeStateDigest: string;
  beforeCounts: {
    saleAggregateLines: number;
    saleItemLines: number;
    returnLines: number;
    returnItemLines: number;
  };
  expectedSourcePins: typeof EXPECTED_SOURCE_FILES;
  authorization: "read-only";
};

export async function runSeptember2026Preflight(input: {
  databaseUrl: string;
  localSourcePaths?: Partial<Record<keyof typeof EXPECTED_SOURCE_FILES, string>>;
}): Promise<{ ok: true; report: SeptemberPreflightReport } | { ok: false; code: string; message: string; report?: SeptemberPreflightReport }> {
  const urlCheck = assertPreflightDatabaseUrl(input.databaseUrl);
  if (!urlCheck.ok) {
    return urlCheck;
  }
  const pgOptions = createPgPoolOptions(input.databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
    max: 1,
  });
  try {
    return await withReadOnlyPreflightSession(pool, async (client) => {
      const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
      const schema = await assertSchema047048Ready(client);
      const catalog =
        process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS === "1"
          ? { ok: true as const, count: 0, sha256: "synthetic-skipped" }
          : await verifyCatalogPin(client);
      const before = await captureSeptember047048BeforeState(client);
      const sourcePins: Record<string, { ok: boolean; code?: string }> = {};
      if (input.localSourcePaths) {
        for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
          const path = input.localSourcePaths[key];
          if (!path) {
            sourcePins[key] = { ok: false, code: "SOURCE_PATH_MISSING" };
            continue;
          }
          const r = await verifySourceFilePin(key, path);
          sourcePins[key] = r.ok ? { ok: true } : { ok: false, code: r.code };
        }
        const allOk = Object.values(sourcePins).every((s) => s.ok);
        if (allOk) {
          const buffers = {
            saleAggregate: await readFile(input.localSourcePaths.saleAggregate!),
            saleItems: await readFile(input.localSourcePaths.saleItems!),
            returnsAggregate: await readFile(input.localSourcePaths.returnsAggregate!),
            returnItems: await readFile(input.localSourcePaths.returnItems!),
          };
          const matched = await verifyMatchedCountsFromSources(client, buffers);
          if (!matched.ok) {
            return { ok: false, code: matched.code, message: matched.message };
          }
        }
      }
      const synthetic = process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS === "1";
      const report: SeptemberPreflightReport = {
        v: 1,
        mode: "preflight",
        saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
        target: {
          timewebAppId: TIMEWEB_APP_ID,
          timewebDbId: TIMEWEB_DB_ID,
          fingerprint: identity.fingerprint,
          fingerprintOk: synthetic ? true : identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT,
        },
        appReleaseRef: APP_RELEASE_REF_FOR_COMPATIBILITY,
        schema047048Ok: schema.ok,
        catalog: catalog.ok ? { ok: true, count: catalog.count, sha256: catalog.sha256 } : { ok: false, code: catalog.code },
        sourcePins,
        beforeStateDigest: before.digest,
        beforeCounts: {
          saleAggregateLines: before.snapshot.saleAggregateLines.length,
          saleItemLines: before.snapshot.saleItemLines.length,
          returnLines: before.snapshot.returnLines.length,
          returnItemLines: before.snapshot.returnItemLines.length,
        },
        expectedSourcePins: EXPECTED_SOURCE_FILES,
        authorization: "read-only",
      };
      if (!schema.ok) {
        return { ok: false, code: schema.code, message: schema.message, report };
      }
      if (!catalog.ok) {
        return { ok: false, code: catalog.code, message: catalog.message, report };
      }
      if (!synthetic && !report.target.fingerprintOk) {
        return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch.", report };
      }
      const badSource = Object.entries(sourcePins).find(([, v]) => !v.ok);
      if (badSource) {
        return {
          ok: false,
          code: badSource[1].code ?? "SOURCE_PIN_FAILED",
          message: `Source pin failed: ${badSource[0]}`,
          report,
        };
      }
      return { ok: true, report };
    });
  } finally {
    await pool.end();
  }
}
