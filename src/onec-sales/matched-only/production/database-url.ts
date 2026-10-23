import { getDatabaseUrl } from "../../../config";

export type ProductionDatabaseUrlFailureCode =
  | "PRODUCTION_DATABASE_URL_MISSING"
  | "TEST_DATABASE_URL_MIXED"
  | "PRODUCTION_USES_TEST_DATABASE";

export type ProductionDatabaseUrlResult =
  | { ok: true; databaseUrl: string }
  | { ok: false; code: ProductionDatabaseUrlFailureCode; message: string };

/**
 * Production executor uses runtime DATABASE_URL only. Never falls back to TEST_DATABASE_URL.
 */
export function resolveProductionDatabaseUrl(): ProductionDatabaseUrlResult {
  const productionUrl = getDatabaseUrl()?.trim();
  if (!productionUrl) {
    return {
      ok: false,
      code: "PRODUCTION_DATABASE_URL_MISSING",
      message: "DATABASE_URL is required for production matched-only executor.",
    };
  }
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (testUrl && testUrl === productionUrl) {
    return {
      ok: false,
      code: "PRODUCTION_USES_TEST_DATABASE",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL for production executor.",
    };
  }
  if (testUrl && testUrl !== productionUrl) {
    return {
      ok: false,
      code: "TEST_DATABASE_URL_MIXED",
      message: "TEST_DATABASE_URL must not be set alongside production DATABASE_URL.",
    };
  }
  return { ok: true, databaseUrl: productionUrl };
}
