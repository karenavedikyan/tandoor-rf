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
  EXPECTED_UNKNOWN_CATALOG_GUID_COUNT,
  SEPTEMBER_2026_SALE_MONTH_ISO,
  TIMEWEB_APP_ID,
  TIMEWEB_DB_ID,
} from "./scope-pins";
import {
  parseSeptemberSourceRosters,
  verifyMatchedCountsFromSources,
  verifySourceBufferPin,
  type SeptemberSourceBuffers,
} from "./source-pins";
import { assertProductionReadOnlyPreflightDatabaseUrl } from "./operator-guard";
import { readSeptemberPreflightJobState } from "./job-state-047-048";
import { analyzeSalesBundle } from "../bundle-analyze";
import { partitionSalesBundle } from "../matched-only/partition";
import { loadKnownLegalGuidSet } from "../matched-only/catalog";
import { buildFinancialTotalsFromPartition } from "../matched-only/apply-persist-materialization";

function pgJsonArrayLength(jsonText: string): number {
  const parsed = JSON.parse(jsonText) as unknown;
  return Array.isArray(parsed) ? parsed.length : 0;
}

import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";

export type { ReadOnlyPreflightTestContext };

export type SeptemberReadOnlyPreflightReport = {
  v: 2;
  mode: "read-only-preflight";
  saleMonth: string;
  target: {
    timewebAppId: number;
    timewebDbId: number;
    fingerprint: string;
    fingerprintOk: boolean;
  };
  /** Compatibility constraint for main app ref — not an observed live release probe. */
  appReleaseRef: { kind: "compatibility_constraint"; ref: string };
  readOnlyProof: {
    transactionIsolation: "REPEATABLE READ";
    readOnly: true;
    noPersistence: true;
    noWriteOperationsInvoked: true;
  };
  schema047048Ok: boolean | null;
  jobState: { pendingOrRunningImportJobs: number } | null;
  catalog: { ok: boolean; count?: number; sha256?: string; code?: string };
  sources: Record<
    keyof typeof EXPECTED_SOURCE_FILES,
    | {
        ok: true;
        path: string;
        sha256: string;
        sha256Ok: true;
        full: number;
        matched: number;
        excluded: number;
        periodOk: true;
      }
    | { ok: false; code: string }
  >;
  unknownUniqueGuidCount: number | null;
  parity: { salesOk: boolean; returnsOk: boolean } | null;
  financialTotals: ReturnType<typeof buildFinancialTotalsFromPartition> | null;
  beforeStateDigest: string | null;
  beforeCounts: {
    saleAggregateLines: number;
    saleItemLines: number;
    returnLines: number;
    returnItemLines: number;
  } | null;
  authorization: "read-only";
};

function emptySourcesReport(): SeptemberReadOnlyPreflightReport["sources"] {
  return {
    saleAggregate: { ok: false, code: "NOT_RUN" },
    saleItems: { ok: false, code: "NOT_RUN" },
    returnsAggregate: { ok: false, code: "NOT_RUN" },
    returnItems: { ok: false, code: "NOT_RUN" },
  };
}

function buildSourcePinReports(buffers: SeptemberSourceBuffers): {
  sources: SeptemberReadOnlyPreflightReport["sources"];
  firstError: { code: string; message: string } | null;
} {
  const sources = {} as SeptemberReadOnlyPreflightReport["sources"];
  let firstError: { code: string; message: string } | null = null;
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const r = verifySourceBufferPin(key, buffers[key]);
    if (!r.ok) {
      sources[key] = { ok: false, code: r.code };
      if (!firstError) {
        firstError = { code: r.code, message: r.message };
      }
      continue;
    }
    sources[key] = {
      ok: true,
      path: r.path,
      sha256: r.sha256,
      sha256Ok: true,
      full: r.full,
      matched: r.matched,
      excluded: r.excluded,
      periodOk: true,
    };
  }
  return { sources, firstError };
}

export async function runSeptember2026ReadOnlyPreflight(input: {
  databaseUrl: string;
  sources: SeptemberSourceBuffers;
  testContext?: ReadOnlyPreflightTestContext;
}): Promise<
  { ok: true; report: SeptemberReadOnlyPreflightReport } | { ok: false; code: string; message: string; report: SeptemberReadOnlyPreflightReport }
> {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) {
    const report: SeptemberReadOnlyPreflightReport = {
      v: 2,
      mode: "read-only-preflight",
      saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
      target: {
        timewebAppId: TIMEWEB_APP_ID,
        timewebDbId: TIMEWEB_DB_ID,
        fingerprint: "",
        fingerprintOk: false,
      },
      appReleaseRef: { kind: "compatibility_constraint", ref: APP_RELEASE_REF_FOR_COMPATIBILITY },
      readOnlyProof: {
        transactionIsolation: "REPEATABLE READ",
        readOnly: true,
        noPersistence: true,
        noWriteOperationsInvoked: true,
      },
      schema047048Ok: null,
      jobState: null,
      catalog: { ok: false, code: urlCheck.code },
      sources: buildSourcePinReports(input.sources).sources,
      unknownUniqueGuidCount: null,
      parity: null,
      financialTotals: null,
      beforeStateDigest: null,
      beforeCounts: null,
      authorization: "read-only",
    };
    return { ok: false, code: urlCheck.code, message: urlCheck.message, report };
  }

  const sourcePins = input.testContext?.skipSourcePinChecks
    ? {
        sources: Object.fromEntries(
          (Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]).map((key) => [
            key,
            {
              ok: true as const,
              path: EXPECTED_SOURCE_FILES[key].path,
              sha256: EXPECTED_SOURCE_FILES[key].sha256,
              sha256Ok: true as const,
              full: EXPECTED_SOURCE_FILES[key].counts.full,
              matched: EXPECTED_SOURCE_FILES[key].counts.matched,
              excluded: EXPECTED_SOURCE_FILES[key].counts.excluded,
              periodOk: true as const,
            },
          ]),
        ) as SeptemberReadOnlyPreflightReport["sources"],
        firstError: null,
      }
    : buildSourcePinReports(input.sources);
  const pgOptions = createPgPoolOptions(input.databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
    max: 1,
  });

  try {
    return await withReadOnlyPreflightSession(pool, async (client) => {
      const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
      const fingerprintOk =
        input.testContext?.skipTargetFingerprintPin === true ||
        identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;

      const baseReport = (): SeptemberReadOnlyPreflightReport => ({
        v: 2,
        mode: "read-only-preflight",
        saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
        target: {
          timewebAppId: TIMEWEB_APP_ID,
          timewebDbId: TIMEWEB_DB_ID,
          fingerprint: identity.fingerprint,
          fingerprintOk,
        },
        appReleaseRef: { kind: "compatibility_constraint", ref: APP_RELEASE_REF_FOR_COMPATIBILITY },
        readOnlyProof: {
          transactionIsolation: "REPEATABLE READ",
          readOnly: true,
          noPersistence: true,
          noWriteOperationsInvoked: true,
        },
        schema047048Ok: null,
        jobState: null,
        catalog: { ok: false, code: "NOT_RUN_WRONG_TARGET" },
        sources: sourcePins.sources,
        unknownUniqueGuidCount: null,
        parity: null,
        financialTotals: null,
        beforeStateDigest: null,
        beforeCounts: null,
        authorization: "read-only",
      });

      if (!fingerprintOk) {
        const report = baseReport();
        report.catalog = { ok: false, code: "NOT_RUN_WRONG_TARGET" };
        return {
          ok: false,
          code: "TARGET_FINGERPRINT_MISMATCH",
          message: "Database fingerprint mismatch.",
          report,
        };
      }

      const schema = await assertSchema047048Ready(client);
      const jobState = await readSeptemberPreflightJobState(client);
      const catalog =
        input.testContext?.skipCatalogPin === true
          ? { ok: true as const, count: 0, sha256: "test-skipped" }
          : await verifyCatalogPin(client);
      const before = await captureSeptember047048BeforeState(client);

      let unknownUniqueGuidCount: number | null = null;
      let parity: SeptemberReadOnlyPreflightReport["parity"] = null;
      let financialTotals: SeptemberReadOnlyPreflightReport["financialTotals"] = null;

      if (sourcePins.firstError) {
        const report = baseReport();
        report.schema047048Ok = schema.ok;
        report.jobState = jobState;
        report.catalog = catalog.ok
          ? { ok: true, count: catalog.count, sha256: catalog.sha256 }
          : { ok: false, code: catalog.code };
        report.beforeStateDigest = before.digest;
        report.beforeCounts = {
          saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
          saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
          returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
          returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson),
        };
        report.sources = sourcePins.sources;
        return {
          ok: false,
          code: sourcePins.firstError.code,
          message: sourcePins.firstError.message,
          report,
        };
      }

      if (!input.testContext?.skipSourcePinChecks) {
        const matched = await verifyMatchedCountsFromSources(client, input.sources);
        if (!matched.ok) {
        const report = baseReport();
        report.schema047048Ok = schema.ok;
        report.jobState = jobState;
        report.catalog = catalog.ok
          ? { ok: true, count: catalog.count, sha256: catalog.sha256 }
          : { ok: false, code: catalog.code };
        report.beforeStateDigest = before.digest;
        report.beforeCounts = {
          saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
          saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
          returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
          returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson),
        };
        report.sources = sourcePins.sources;
          return { ok: false, code: matched.code, message: matched.message, report };
        }

        const rosters = parseSeptemberSourceRosters(input.sources);
        const known = await loadKnownLegalGuidSet(client);
        const partition = partitionSalesBundle({ ...rosters, known });
        const analyze = analyzeSalesBundle({
          salesAggregate: rosters.saleAggregate,
          salesItems: rosters.saleItems,
          returnsAggregate: rosters.returnsAggregate,
          returnsItems: rosters.returnItems,
          knownCatalogLegalGuids: known,
        });
        unknownUniqueGuidCount = analyze.unmatchedCatalogGuids.length;
        parity = {
          salesOk:
            analyze.parity.onlyAggregate === 0 &&
            analyze.parity.onlyItems === 0 &&
            analyze.parity.metricMismatches === 0,
          returnsOk: analyze.returnsParity.parityOk,
        };
        financialTotals = buildFinancialTotalsFromPartition(partition);
      }

      const report: SeptemberReadOnlyPreflightReport = {
        ...baseReport(),
        schema047048Ok: schema.ok,
        jobState,
        catalog: catalog.ok
          ? { ok: true, count: catalog.count, sha256: catalog.sha256 }
          : { ok: false, code: catalog.code },
        sources: sourcePins.sources,
        unknownUniqueGuidCount,
        parity,
        financialTotals,
        beforeStateDigest: before.digest,
        beforeCounts: {
          saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
          saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
          returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
          returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson),
        },
      };

      if (!schema.ok) {
        return { ok: false, code: schema.code, message: schema.message, report };
      }
      if (!catalog.ok) {
        return { ok: false, code: catalog.code, message: catalog.message, report };
      }
      if (!input.testContext?.skipSourcePinChecks) {
        if (unknownUniqueGuidCount !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
          return {
            ok: false,
            code: "UNKNOWN_GUID_COUNT_MISMATCH",
            message: `Expected ${EXPECTED_UNKNOWN_CATALOG_GUID_COUNT} unknown GUIDs.`,
            report,
          };
        }
        if (!parity?.salesOk || !parity?.returnsOk) {
          return { ok: false, code: "SOURCE_PARITY_FAILED", message: "Aggregate/items parity check failed.", report };
        }
      }
      return { ok: true, report };
    });
  } finally {
    await pool.end();
  }
}
