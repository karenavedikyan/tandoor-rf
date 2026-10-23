/** Frozen operator scope for the single September 2026 load (change → STOP). */

export const SEPTEMBER_2026_SALE_MONTH_ISO = "2026-09-01";

export const TIMEWEB_APP_ID = 258_307;
export const TIMEWEB_DB_ID = 4_212_461;

export const EXPECTED_TARGET_DB_FINGERPRINT =
  "42946d0cc9e541918783dbd963c483227afb20428cad51af64481c3b2ab38f0f";

export const EXPECTED_CATALOG_LEGAL_ENTITY_COUNT = 2747;
export const EXPECTED_CATALOG_GUID_SET_SHA256 =
  "33cd0d4220afdbd310b54db4564117ee4112f58305bb022e104e80f450c607be";

export const EXPECTED_UNKNOWN_CATALOG_GUID_COUNT = 414;

/** Computer-prepared runtime input directory (read-only; no FTP refresh). */
export const FIXED_SOURCE_SNAPSHOT_DIRECTORY = "/tmp/tandoor-source-snapshot-20261024-4c64a1a4";

export const EXPECTED_SOURCE_MANIFEST_SHA256 =
  "cb390602949e493ce678706c471dc19bd502c7eb3ff1886b250eb0791b556cb5";

export const EXPECTED_OPERATOR_DATA_SCOPE_SHA256 =
  "f1daa71dce9172f93ab8590148634c0d09013ae07b60f5f8a6675392c793d9aa";

export const EXPECTED_EMPTY_BEFORE_STATE_DIGEST =
  "b8b0946873bc8079c559c9b5f746e7388bfa6c4555c2d33bcc611947b14b8ce5";

export const EXPECTED_MATCHED_ROW_TOTAL = 28_556;
export const EXPECTED_EXCLUDED_ROW_TOTAL = 4_024;

export const EXPECTED_APPLY_MATCHED_ROWS = {
  saleAggregate: 3416,
  saleItems: 24_030,
  returnsAggregate: 413,
  returnItems: 697,
} as const;

export const EXPECTED_SOURCE_FILES = {
  saleAggregate: {
    path: "/LC/sale/sale.json",
    fileName: "sale.json",
    sha256: "93892acff9ae8c99aba3cd6d78257e6c9e68c320d65b387cb085a8910c784361",
    counts: { full: 4415, matched: 3416, excluded: 999 },
  },
  saleItems: {
    path: "/LC/sale/sale(items).json",
    fileName: "sale(items).json",
    sha256: "63dc03737858ddabe34aa0f7e7001caeefe8f7b961eb9f264c8ba545dda43def",
    counts: { full: 26928, matched: 24030, excluded: 2898 },
  },
  returnsAggregate: {
    path: "/LC/sale/returne.json",
    fileName: "returne.json",
    sha256: "dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb",
    counts: { full: 462, matched: 413, excluded: 49 },
  },
  returnItems: {
    path: "/LC/sale/returne(items).json",
    fileName: "returne(items).json",
    sha256: "755560ee94a1001802cee6c91e5ddca40a296447f011999a76fa97d6bb7e7164",
    counts: { full: 775, matched: 697, excluded: 78 },
  },
} as const;

export const REQUIRED_MIGRATIONS_047_048 = [
  "047_onec_v3_legal_sales_items_returns.sql",
  "048_onec_v3_sales_month_activation.sql",
] as const;

export const APP_RELEASE_REF_FOR_COMPATIBILITY = "6109c1a23a2528a1471da92c4a126b492ff6ca84";
