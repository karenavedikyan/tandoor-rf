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

export const FROZEN_OPERATOR_DATA_SCOPE_KIND =
  "FROZEN_SEPTEMBER_MATCHED_ONLY_SCOPE_CANDIDATE_NOT_WRITE_AUTHORIZATION";

export type OperatorDataScopeV1 = {
  v: 1;
  kind: typeof FROZEN_OPERATOR_DATA_SCOPE_KIND;
  appId: number;
  databaseId: number;
  targetFingerprint: string;
  appRelease: string;
  saleMonth: string;
  sourceDirectory: string;
  manifestSha256: string;
  sources: Record<
    keyof typeof EXPECTED_SOURCE_FILES,
    { sha256: string; bytes: number; rawRows: number; guidFields: number; legacyIdFields: number }
  >;
  counts: Record<keyof typeof EXPECTED_SOURCE_FILES, { full: number; matched: number; excluded: number }>;
  catalog: { count: number; sha256: string };
  unknownUniqueGuidCount: number;
  unknownUnionSha256: string;
  financialTotals: Record<string, Record<string, Record<string, string>>>;
  beforeStateDigest: string;
  beforeCounts: {
    saleAggregateLinesJson: number;
    saleItemLinesJson: number;
    returnLinesJson: number;
    returnItemLinesJson: number;
    importStatesJson: number;
    monthActivationsJson: number;
  };
  expectedMatchedRows: number;
  excludedRows: number;
  allowedBusinessTables: string[];
  allowedMetadata: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateOperatorDataScopeDocument(
  doc: OperatorDataScopeV1,
  options?: { skipProductionPins?: boolean },
): { ok: true } | { ok: false; code: string; message: string } {
  if (doc.v !== 1 || doc.kind !== FROZEN_OPERATOR_DATA_SCOPE_KIND) {
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
  if (!options?.skipProductionPins && doc.sourceDirectory !== FIXED_SOURCE_SNAPSHOT_DIRECTORY) {
    return { ok: false, code: "SCOPE_SOURCE_DIRECTORY", message: "Source directory mismatch." };
  }
  if (!options?.skipProductionPins && doc.manifestSha256 !== EXPECTED_SOURCE_MANIFEST_SHA256) {
    return { ok: false, code: "SCOPE_MANIFEST_SHA", message: "Manifest SHA mismatch." };
  }
  if (typeof doc.allowedMetadata !== "string" || !doc.allowedMetadata.trim()) {
    return { ok: false, code: "SCOPE_ALLOWED_METADATA", message: "allowedMetadata must be a non-empty string." };
  }
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const pin = EXPECTED_SOURCE_FILES[key];
    const src = doc.sources[key];
    const counts = doc.counts[key];
    if (!src || typeof src.guidFields !== "number" || typeof src.legacyIdFields !== "number") {
      return { ok: false, code: "SCOPE_SOURCE_FIELDS", message: `Invalid source field counters: ${key}` };
    }
    if (!options?.skipProductionPins && (src.sha256 !== pin.sha256 || src.rawRows !== pin.counts.full)) {
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
  if (!options?.skipProductionPins && doc.beforeStateDigest !== EXPECTED_EMPTY_BEFORE_STATE_DIGEST) {
    return { ok: false, code: "SCOPE_BEFORE_DIGEST", message: "Before digest mismatch." };
  }
  const bc = doc.beforeCounts;
  if (
    bc.saleAggregateLinesJson !== 0 ||
    bc.saleItemLinesJson !== 0 ||
    bc.returnLinesJson !== 0 ||
    bc.returnItemLinesJson !== 0 ||
    bc.importStatesJson !== 0 ||
    bc.monthActivationsJson !== 0
  ) {
    return { ok: false, code: "SCOPE_BEFORE_COUNTS", message: "Before counts must be empty." };
  }
  if (doc.expectedMatchedRows !== EXPECTED_MATCHED_ROW_TOTAL || doc.excludedRows !== EXPECTED_EXCLUDED_ROW_TOTAL) {
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
  if (!isRecord(doc.financialTotals)) {
    return { ok: false, code: "SCOPE_FINANCIAL_TOTALS", message: "financialTotals must be an object." };
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
  const valid = validateOperatorDataScopeDocument(doc, { skipProductionPins: input.skipProductionShaPin });
  if (!valid.ok) return valid;
  return { ok: true, scope: doc, sha256: sha };
}
