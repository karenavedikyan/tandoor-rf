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

export const EXPECTED_SOURCE_FILES = {
  saleAggregate: {
    path: "/LC/sale/sale.json",
    sha256: "1e7db83fce17f3a10bc9d63d3c913283db4f900794e1212666d6e44d76d51d5e",
    counts: { full: 4415, matched: 3416, excluded: 999 },
  },
  saleItems: {
    path: "/LC/sale/sale(items).json",
    sha256: "9e35a3fae84e8cd46d8413277b8251ecbd0429447654499fc1d0c51878d762cc",
    counts: { full: 26928, matched: 24030, excluded: 2898 },
  },
  returnsAggregate: {
    path: "/LC/sale/returne.json",
    sha256: "dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb",
    counts: { full: 462, matched: 413, excluded: 49 },
  },
  returnItems: {
    path: "/LC/sale/returne(items).json",
    sha256: "755560ee94a1001802cee6c91e5ddca40a296447f011999a76fa97d6bb7e7164",
    counts: { full: 775, matched: 697, excluded: 78 },
  },
} as const;

export const REQUIRED_MIGRATIONS_047_048 = [
  "047_onec_v3_legal_sales_items_returns.sql",
  "048_onec_v3_sales_month_activation.sql",
] as const;

export const APP_RELEASE_REF_FOR_COMPATIBILITY = "6109c1a23a2528a1471da92c4a126b492ff6ca84";
