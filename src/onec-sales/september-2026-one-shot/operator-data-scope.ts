import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  APP_RELEASE_REF_FOR_COMPATIBILITY,
  EXPECTED_CATALOG_GUID_SET_SHA256,
  EXPECTED_CATALOG_LEGAL_ENTITY_COUNT,
  EXPECTED_EMPTY_BEFORE_STATE_DIGEST,
  EXPECTED_EXCLUDED_ROW_TOTAL,
  EXPECTED_MATCHED_ROW_TOTAL,
  EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
  EXPECTED_SOURCE_FILES,
  EXPECTED_TARGET_DB_FINGERPRINT,
  EXPECTED_UNKNOWN_CATALOG_GUID_COUNT,
  FIXED_SOURCE_SNAPSHOT_DIRECTORY,
  EXPECTED_SOURCE_MANIFEST_SHA256,
  SEPTEMBER_2026_SALE_MONTH_ISO,
  TIMEWEB_APP_ID,
  TIMEWEB_DB_ID,
} from "./scope-pins";

export type OperatorDataScopeV1 = {
  v: 1;
  kind: "september-2026-operator-data-scope";
  appId: number;
  databaseId: number;
  targetFingerprint: string;
  appRelease: string;
  saleMonth: string;
  sourceDirectory: string;
  manifestSha256: string;
  sources: Record<
    keyof typeof EXPECTED_SOURCE_FILES,
    { sha256: string; bytes: number; rawRows: number; guidFields: string[]; legacyIdFields: string[] }
  >;
  counts: Record<keyof typeof EXPECTED_SOURCE_FILES, { full: number; matched: number; excluded: number }>;
  catalog: { count: number; sha256: string };
  unknownUniqueGuidCount: number;
  unknownUnionSha256: string;
  financialTotals: Record<string, Record<string, Record<string, string>>>;
  beforeStateDigest: string;
  beforeCounts: {
    saleAggregateLines: number;
    saleItemLines: number;
    returnLines: number;
    returnItemLines: number;
    importStatesPresent: number;
    monthActivationsPresent: number;
  };
  expectedMatchedRows: number;
  expectedExcludedRows: number;
  allowedBusinessTables: string[];
  allowedMetadata: string[];
  migrationsAllowed: boolean;
  sourceFtpRefreshAllowed: boolean;
  backupBusinessValuesAuthorized: boolean;
  applyAuthorized: boolean;
  rollbackAuthorized: boolean;
};

export function operatorDataScopeSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function unknownUnionSha256FromGuids(guids: string[]): string {
  const sorted = guids.map((g) => g.toLowerCase()).sort();
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

export function validateOperatorDataScopeDocument(
  doc: OperatorDataScopeV1,
  options?: { skipProductionShaPin?: boolean },
): { ok: true } | { ok: false; code: string; message: string } {
  if (doc.v !== 1 || doc.kind !== "september-2026-operator-data-scope") {
    return { ok: false, code: "SCOPE_VERSION", message: "Invalid scope version/kind." };
  }
  if (doc.appId !== TIMEWEB_APP_ID || doc.databaseId !== TIMEWEB_DB_ID) {
    return { ok: false, code: "SCOPE_TARGET_IDS", message: "App/DB id mismatch." };
  }
  if (doc.targetFingerprint !== EXPECTED_TARGET_DB_FINGERPRINT) {
    return { ok: false, code: "SCOPE_TARGET_FINGERPRINT", message: "Target fingerprint mismatch." };
  }
  if (doc.appRelease !== APP_RELEASE_REF_FOR_COMPATIBILITY) {
    return { ok: false, code: "SCOPE_APP_RELEASE", message: "App release mismatch." };
  }
  if (doc.saleMonth !== SEPTEMBER_2026_SALE_MONTH_ISO) {
    return { ok: false, code: "SCOPE_SALE_MONTH", message: "Sale month mismatch." };
  }
  if (!options?.skipProductionShaPin && doc.sourceDirectory !== FIXED_SOURCE_SNAPSHOT_DIRECTORY) {
    return { ok: false, code: "SCOPE_SOURCE_DIRECTORY", message: "Source directory mismatch." };
  }
  if (doc.manifestSha256 !== EXPECTED_SOURCE_MANIFEST_SHA256) {
    return { ok: false, code: "SCOPE_MANIFEST_SHA", message: "Manifest SHA mismatch." };
  }
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const pin = EXPECTED_SOURCE_FILES[key];
    const src = doc.sources[key];
    const counts = doc.counts[key];
    if (!src || src.sha256 !== pin.sha256 || src.rawRows !== pin.counts.full) {
      return { ok: false, code: "SCOPE_SOURCE_PIN", message: `Source pin mismatch: ${key}` };
    }
    if (
      counts.full !== pin.counts.full ||
      counts.matched !== pin.counts.matched ||
      counts.excluded !== pin.counts.excluded
    ) {
      return { ok: false, code: "SCOPE_SOURCE_COUNTS", message: `Source counts mismatch: ${key}` };
    }
  }
  if (doc.catalog.count !== EXPECTED_CATALOG_LEGAL_ENTITY_COUNT) {
    return { ok: false, code: "SCOPE_CATALOG_COUNT", message: "Catalog count mismatch." };
  }
  if (doc.catalog.sha256 !== EXPECTED_CATALOG_GUID_SET_SHA256) {
    return { ok: false, code: "SCOPE_CATALOG_SHA", message: "Catalog SHA mismatch." };
  }
  if (doc.unknownUniqueGuidCount !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
    return { ok: false, code: "SCOPE_UNKNOWN_COUNT", message: "Unknown GUID count mismatch." };
  }
  if (doc.beforeStateDigest !== EXPECTED_EMPTY_BEFORE_STATE_DIGEST) {
    return { ok: false, code: "SCOPE_BEFORE_DIGEST", message: "Before digest mismatch." };
  }
  if (
    doc.beforeCounts.saleAggregateLines !== 0 ||
    doc.beforeCounts.saleItemLines !== 0 ||
    doc.beforeCounts.returnLines !== 0 ||
    doc.beforeCounts.returnItemLines !== 0 ||
    doc.beforeCounts.importStatesPresent !== 0 ||
    doc.beforeCounts.monthActivationsPresent !== 0
  ) {
    return { ok: false, code: "SCOPE_BEFORE_COUNTS", message: "Before counts must be empty." };
  }
  if (doc.expectedMatchedRows !== EXPECTED_MATCHED_ROW_TOTAL || doc.expectedExcludedRows !== EXPECTED_EXCLUDED_ROW_TOTAL) {
    return { ok: false, code: "SCOPE_ROW_TOTALS", message: "Matched/excluded totals mismatch." };
  }
  if (
    doc.migrationsAllowed !== false ||
    doc.sourceFtpRefreshAllowed !== false ||
    doc.backupBusinessValuesAuthorized !== false ||
    doc.applyAuthorized !== false ||
    doc.rollbackAuthorized !== false
  ) {
    return { ok: false, code: "CANDIDATE_NOT_WRITE_AUTHORIZATION", message: "Write flags must remain false." };
  }
  return { ok: true };
}

export async function loadAndVerifyOperatorDataScope(input: {
  scopeFilePath: string;
  expectedSha256: string;
  skipProductionShaPin?: boolean;
}): Promise<
  { ok: true; scope: OperatorDataScopeV1; sha256: string } | { ok: false; code: string; message: string }
> {
  const bytes = await readFile(input.scopeFilePath);
  const sha = operatorDataScopeSha256(bytes);
  if (!input.skipProductionShaPin && sha !== input.expectedSha256) {
    return { ok: false, code: "OPERATOR_DATA_SCOPE_SHA_MISMATCH", message: "Operator data scope SHA mismatch." };
  }
  if (!input.skipProductionShaPin && sha !== EXPECTED_OPERATOR_DATA_SCOPE_SHA256) {
    return { ok: false, code: "OPERATOR_DATA_SCOPE_SHA_MISMATCH", message: "Pinned operator data scope SHA mismatch." };
  }
  const doc = JSON.parse(bytes.toString("utf8")) as OperatorDataScopeV1;
  const valid = validateOperatorDataScopeDocument(doc, { skipProductionShaPin: input.skipProductionShaPin });
  if (!valid.ok) return valid;
  return { ok: true, scope: doc, sha256: sha };
}
