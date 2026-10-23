import { createHash } from "node:crypto";
import { chmod, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { OperatorDataScopeV1 } from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";
import {
  FROZEN_OPERATOR_DATA_SCOPE_KIND,
  unknownUnionSha256FromGuids,
} from "../../src/onec-sales/september-2026-one-shot/operator-data-scope";
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
import {
  backupReceiptSha256,
  buildEmptyBeforeBackupReceiptBinding,
  type SeptemberBackupReceiptV1,
} from "../../src/onec-sales/september-2026-one-shot/backup-receipt-verify";

export async function writeSyntheticSeptemberSnapshot(dir: string): Promise<{ buffers: SeptemberSourceBuffers }> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const buffers: SeptemberSourceBuffers = {
    saleAggregate: buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", quantity: 1, income: 100 }),
    ]),
    saleItems: buildSaleJsonBytes([buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 })]),
    returnsAggregate: Buffer.from("[]\n"),
    returnItems: Buffer.from("[]\n"),
  };
  const files = [
    ["manifest.json", JSON.stringify({ v: 1, synthetic: true })],
    ["sale.json", buffers.saleAggregate],
    ["sale(items).json", buffers.saleItems],
    ["returne.json", buffers.returnsAggregate],
    ["returne(items).json", buffers.returnItems],
  ] as const;
  for (const [name, body] of files) {
    await writeFile(join(dir, name), body, { mode: 0o600 });
    await chmod(join(dir, name), 0o600);
  }
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
  const matched =
    partition.saleAggregate.matched.length +
    partition.saleItems.matched.length +
    partition.returnsAggregate.matched.length +
    partition.returnItems.matched.length;
  const excluded =
    partition.saleAggregate.excluded.length +
    partition.saleItems.excluded.length +
    partition.returnsAggregate.excluded.length +
    partition.returnItems.excluded.length;
  return {
    v: 1,
    kind: FROZEN_OPERATOR_DATA_SCOPE_KIND,
    appId: TIMEWEB_APP_ID,
    databaseId: TIMEWEB_DB_ID,
    targetFingerprint: input.targetFingerprint,
    appRelease: APP_RELEASE_REF_FOR_COMPATIBILITY,
    saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
    sourceDirectory: "synthetic",
    manifestSha256: "synthetic",
    sources: {
      saleAggregate: {
        sha256: "synthetic",
        bytes: input.buffers.saleAggregate.length,
        rawRows: rosters.saleAggregate.lines.length,
        guidFields: 1,
        legacyIdFields: 0,
      },
      saleItems: {
        sha256: "synthetic",
        bytes: input.buffers.saleItems.length,
        rawRows: rosters.saleItems.lines.length,
        guidFields: 1,
        legacyIdFields: 0,
      },
      returnsAggregate: {
        sha256: "synthetic",
        bytes: input.buffers.returnsAggregate.length,
        rawRows: rosters.returnsAggregate.lines.length,
        guidFields: 1,
        legacyIdFields: 0,
      },
      returnItems: {
        sha256: "synthetic",
        bytes: input.buffers.returnItems.length,
        rawRows: rosters.returnItems.lines.length,
        guidFields: 1,
        legacyIdFields: 0,
      },
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
      saleAggregateLinesJson: 0,
      saleItemLinesJson: 0,
      returnLinesJson: 0,
      returnItemLinesJson: 0,
      importStatesJson: 0,
      monthActivationsJson: 0,
    },
    expectedMatchedRows: matched,
    excludedRows: excluded,
    allowedBusinessTables: [
      "onec_v3_legal_sales_lines",
      "onec_v3_legal_sale_item_lines",
      "onec_v3_legal_return_lines",
      "onec_v3_legal_return_item_lines",
    ],
    allowedMetadata:
      "Synthetic test scope only — four corresponding import_state id=1 and four September month_activation rows only",
    migrationsAllowed: false,
    sourceFtpRefreshAllowed: false,
    backupBusinessValuesAuthorized: false,
    applyAuthorized: input.applyAuthorized,
    rollbackAuthorized: false,
  };
}

export async function writeSyntheticBackupReceiptFile(input: {
  dir: string;
  targetFingerprint: string;
  scopeFileSha256: string;
  beforeStateDigest: string;
  backupPayloadSha256?: string;
}): Promise<{ path: string; sha256: string; receipt: SeptemberBackupReceiptV1 }> {
  const payloadSha =
    input.backupPayloadSha256 ??
    createHash("sha256").update("synthetic-empty-before-backup-payload", "utf8").digest("hex");
  const receipt = buildEmptyBeforeBackupReceiptBinding({
    targetDbFingerprint: input.targetFingerprint,
    scopeFileSha256: input.scopeFileSha256,
    beforeStateSha256: input.beforeStateDigest,
    backupPayloadSha256: payloadSha,
  });
  const text = JSON.stringify(receipt);
  const path = join(input.dir, "backup-receipt.json");
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  if (sha256 !== backupReceiptSha256(receipt)) {
    throw new Error("backup receipt file SHA must match canonical receipt hash");
  }
  return { path, sha256, receipt };
}
