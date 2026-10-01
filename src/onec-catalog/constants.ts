export const CATALOG_IMPORT_PROFILES = ["full", "distribution"] as const;
export type CatalogImportProfile = (typeof CATALOG_IMPORT_PROFILES)[number];
export const DEFAULT_CATALOG_IMPORT_PROFILE: CatalogImportProfile = "full";

export const CATALOG_RELATIVE_FILES = [
  "catalog/groups/data.xml",
  "catalog/section/data.xml",
  "catalog/storage/data.xml",
  "catalog/types_prices/data.xml",
  "catalog/products/data.xml",
  "catalog/prices/data.xml",
  "catalog/stock/data.xml",
  "catalog/stock_expected/data.xml",
] as const;

export type CatalogRelativeFile = (typeof CATALOG_RELATIVE_FILES)[number];

/** Distribution stage: product selection without commercial layers. */
export const CATALOG_DISTRIBUTION_FILES = [
  "catalog/groups/data.xml",
  "catalog/section/data.xml",
  "catalog/products/data.xml",
] as const;

export function getCatalogFilesForProfile(
  profile: CatalogImportProfile,
): readonly CatalogRelativeFile[] {
  return profile === "distribution" ? CATALOG_DISTRIBUTION_FILES : CATALOG_RELATIVE_FILES;
}

export const MAX_CLASSIFICATION_WARNING_SAMPLES = 5;

export const CATALOG_FILE_ROOTS: Record<CatalogRelativeFile, string> = {
  "catalog/groups/data.xml": "Группы",
  "catalog/section/data.xml": "Разделы",
  "catalog/storage/data.xml": "Склады",
  "catalog/types_prices/data.xml": "ТипыЦен",
  "catalog/products/data.xml": "Товары",
  "catalog/prices/data.xml": "Цены",
  "catalog/stock/data.xml": "ОстаткиСклада",
  "catalog/stock_expected/data.xml": "ОжидаемыеОстаткиСклада",
};

/** Per-file limit: observed products ~31 MiB; 64 MiB headroom. */
export const MAX_CATALOG_FILE_BYTES = 64 * 1024 * 1024;

/** Whole-set limit for eight files. */
export const MAX_CATALOG_SET_BYTES = 128 * 1024 * 1024;

export const FTP_READ_DEADLINE_MS = 120_000;
export const STABILITY_DELAY_MS = 2_000;
export const MAX_XML_DEPTH = 24;
export const MAX_XML_ELEMENTS = 1_500_000;
export const MAX_XML_PARSE_MS = 180_000;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 8192;
export const MAX_TEXT_NODE_LENGTH = 65_536;

export const MAX_DETAILED_ERRORS = 50;
export const MAX_DETAILED_WARNINGS = 20;
export const MAX_DETAILED_QUARANTINE = 20;

export const IMPORT_ADVISORY_LOCK_KEY = 902_451_003;

/** Accepted parent-code representations for hierarchy roots (observed + empty). */
export const ROOT_PARENT_CODES = new Set(["", "0"]);

export const DB_CONNECT_TIMEOUT_MS = 5_000;
export const DB_STATEMENT_TIMEOUT_MS = 120_000;
export const DB_APPLY_OPERATION_TIMEOUT_MS = 300_000;
export const DB_RECOVERY_STATEMENT_TIMEOUT_MS = 10_000;

export const QUARANTINE_REASON = {
  UNKNOWN_PRICE_TYPE: "UNKNOWN_PRICE_TYPE",
  MISSING_PRODUCT: "MISSING_PRODUCT",
  MISSING_STORAGE: "MISSING_STORAGE",
  INVALID_DECIMAL: "INVALID_DECIMAL",
  INVALID_DATE: "INVALID_DATE",
  NUMERIC_OUT_OF_RANGE: "NUMERIC_OUT_OF_RANGE",
} as const;
