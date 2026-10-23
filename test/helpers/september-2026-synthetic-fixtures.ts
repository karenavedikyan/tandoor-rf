import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { OperatorDataScopeV1 } from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";
import { unknownUnionSha256FromGuids } from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";
import { buildOperatorFinancialTotalsFromPartition } from "../../src/onec-sales/september-2026-one-shot/operator-financial-budget";
import { partitionSalesBundle } from "../../src/onec-sales/matched-only/partition";
import { parseSeptemberSourceRosters, type SeptemberSourceBuffers } from "../../src/onec-sales/september-2026-one-shot/source-pins";
import {
  APP_RELEASE_REF_FOR_COMPATIBILITY,
  SEPTEMBER_2026_SALE_MONTH_ISO,
  TIMEWEB_APP_ID,
  TIMEWEB_DB_ID,
} from "../../src/onec-sales/september-2026-one-shot/scope-pins";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A } from "./legal-sales-fixtures";
import { buildSaleItemRecord } from "./sales-bundle-fixtures";

export async function writeSyntheticSeptemberSnapshot(dir: string): Promise<{ buffers: SeptemberSourceBuffers }> {
  await mkdir(dir, { recursive: true });
  const buffers: SeptemberSourceBuffers = {
    saleAggregate: buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", quantity: 1, income: 100 }),
    ]),
    saleItems: buildSaleJsonBytes([buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 })]),
    returnsAggregate: Buffer.from("[]\n"),
    returnItems: Buffer.from("[]\n"),
  };
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ v: 1, synthetic: true }), "utf8");
  await writeFile(join(dir, "sale.json"), buffers.saleAggregate);
  await writeFile(join(dir, "sale(items).json"), buffers.saleItems);
  await writeFile(join(dir, "returne.json"), buffers.returnsAggregate);
  await writeFile(join(dir, "returne(items).json"), buffers.returnItems);
  return { buffers };
}

export function buildSyntheticOperatorScope(input: {
  beforeStateDigest: string;
  known: Set<string>;
  buffers: SeptemberSourceBuffers;
  applyAuthorized: boolean;
  targetFingerprint: string;
}): OperatorDataScopeV1 {
  const rosters = parseSeptemberSourceRosters(input.buffers);
  const partition = partitionSalesBundle({ ...rosters, known: input.known });
  const financialTotals = buildOperatorFinancialTotalsFromPartition(partition);
  const unknownUnionSha256 = unknownUnionSha256FromGuids(partition.unknownGuids);
  const matched = {
    saleAggregate: partition.saleAggregate.matched.length,
    saleItems: partition.saleItems.matched.length,
    returnsAggregate: partition.returnsAggregate.matched.length,
    returnItems: partition.returnItems.matched.length,
  };
  const excluded =
    partition.saleAggregate.excluded.length +
    partition.saleItems.excluded.length +
    partition.returnsAggregate.excluded.length +
    partition.returnItems.excluded.length;
  return {
    v: 1,
    kind: "september-2026-operator-data-scope",
    appId: TIMEWEB_APP_ID,
    databaseId: TIMEWEB_DB_ID,
    targetFingerprint: input.targetFingerprint,
    appRelease: APP_RELEASE_REF_FOR_COMPATIBILITY,
    saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
    sourceDirectory: "synthetic",
    manifestSha256: "synthetic",
    sources: {
      saleAggregate: { sha256: "synthetic", bytes: buffersSize(input.buffers.saleAggregate), rawRows: rosters.saleAggregate.lines.length, guidFields: ["legalGuid"], legacyIdFields: [] },
      saleItems: { sha256: "synthetic", bytes: buffersSize(input.buffers.saleItems), rawRows: rosters.saleItems.lines.length, guidFields: ["legalGuid"], legacyIdFields: [] },
      returnsAggregate: { sha256: "synthetic", bytes: buffersSize(input.buffers.returnsAggregate), rawRows: rosters.returnsAggregate.lines.length, guidFields: ["legalGuid"], legacyIdFields: [] },
      returnItems: { sha256: "synthetic", bytes: buffersSize(input.buffers.returnItems), rawRows: rosters.returnItems.lines.length, guidFields: ["legalGuid"], legacyIdFields: [] },
    },
    counts: {
      saleAggregate: partition.saleAggregate.counts,
      saleItems: partition.saleItems.counts,
      returnsAggregate: partition.returnsAggregate.counts,
      returnItems: partition.returnItems.counts,
    },
    catalog: { count: input.known.size, sha256: "synthetic" },
    unknownUniqueGuidCount: partition.unknownGuids.length,
    unknownUnionSha256,
    financialTotals: financialTotals as OperatorDataScopeV1["financialTotals"],
    beforeStateDigest: input.beforeStateDigest,
    beforeCounts: {
      saleAggregateLines: 0,
      saleItemLines: 0,
      returnLines: 0,
      returnItemLines: 0,
      importStatesPresent: 0,
      monthActivationsPresent: 0,
    },
    expectedMatchedRows: matched.saleAggregate + matched.saleItems + matched.returnsAggregate + matched.returnItems,
    expectedExcludedRows: excluded,
    allowedBusinessTables: [],
    allowedMetadata: [],
    migrationsAllowed: false,
    sourceFtpRefreshAllowed: false,
    backupBusinessValuesAuthorized: false,
    applyAuthorized: input.applyAuthorized,
    rollbackAuthorized: false,
  };
}

function buffersSize(buf: Buffer): number {
  return buf.length;
}
