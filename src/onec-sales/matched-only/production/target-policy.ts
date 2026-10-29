/** Control-plane identifiers — not SQL proof of target identity. */
export const TIMEWEB_MATCHED_ONLY_APP_ID = 258_307;
export const TIMEWEB_MATCHED_ONLY_DB_ID = 4_212_461;

/**
 * Expected production PostgreSQL identity fingerprint (Timeweb DB4212461).
 * If live fingerprint differs, STOP until owner review — never auto-update this value.
 */
export const EXPECTED_PRODUCTION_DB_FINGERPRINT =
  "42946d0cc9e541918783dbd963c483227afb20428cad51af64481c3b2ab38f0f";

export const REQUIRED_MATCHED_ONLY_MIGRATIONS = [
  "047_onec_v3_legal_sales_items_returns.sql",
  "048_onec_v3_sales_month_activation.sql",
  "049_onec_v3_legal_sales_matched_only_sidecar.sql",
] as const;

/** Draft migration 049 SQL SHA-256 (release evidence; not applied in production yet). */
export const DRAFT_MIGRATION_049_SQL_SHA256 =
  "992e21c6dce071bab2a4e915612618c576be0862d2afe963ad957249dcd612eb";

/** Synthetic local PG harness only — pinned executable artifact digest for verified write tests. */
export const SYNTHETIC_TEST_EXECUTABLE_ARTIFACT_SHA256 =
  "5e505993e697a67afabc6c41d391e6d34e529287db4f0c6884a69d7719c8d195";
