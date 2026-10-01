import type { CatalogRelativeFile } from "./constants";

export type CatalogImportMode = "dry_run" | "apply";

export type CatalogFileEntry = {
  relativePath: CatalogRelativeFile;
  bytes: Buffer;
  byteSize: number;
  sha256: string;
};

export type CatalogManifest = {
  files: CatalogFileEntry[];
  manifestSha256: string;
  totalByteSize: number;
};

export type ValidationIssue = {
  code: string;
  message: string;
  file?: CatalogRelativeFile;
  line?: number;
};

export type SchemaDriftWarning = {
  code: "SCHEMA_DRIFT";
  message: string;
  file: CatalogRelativeFile;
  element: string;
};

export type QuarantineEntry = {
  layer: "prices" | "stock" | "stock_expected";
  reasonCode: string;
  sourceIdentifiers: Record<string, string>;
};

export type ParsedCatalogGroup = { code: string; parentCode: string | null };
export type ParsedCatalogSection = { code: string; name: string; parentCode: string | null };
export type ParsedCatalogStorage = {
  code: string;
  name: string;
  address: string;
  email: string;
  phone: string;
};
export type ParsedCatalogPriceType = { priceTypeCode: string; name: string };
export type ParsedCatalogProduct = {
  code: string;
  groupCode: string | null;
  activity: string;
  name: string;
  properties: Array<{ code: string; name: string; value: string }>;
  images: string[];
  sectionCodes: string[];
};
export type ParsedCatalogPrice = {
  priceTypeCode: string;
  productCode: string;
  priceRaw: string;
};
export type ParsedCatalogStockLine = {
  productCode: string;
  storageCode: string;
  quantityRaw: string;
};
export type ParsedCatalogStockExpectedLine = {
  productCode: string;
  storageCode: string;
  quantityRaw: string;
  expectedDateRaw: string | null;
  availableRaw: string | null;
};

export type ParsedCatalogSet = {
  manifest: CatalogManifest;
  groups: ParsedCatalogGroup[];
  sections: ParsedCatalogSection[];
  storages: ParsedCatalogStorage[];
  priceTypes: ParsedCatalogPriceType[];
  products: ParsedCatalogProduct[];
  prices: ParsedCatalogPrice[];
  stock: ParsedCatalogStockLine[];
  stockExpected: ParsedCatalogStockExpectedLine[];
  warnings: SchemaDriftWarning[];
  quarantine: QuarantineEntry[];
  productCodes?: Set<string>;
  groupCodes?: Set<string>;
  sectionCodes?: Set<string>;
  storageCodes?: Set<string>;
  priceTypeCodes?: Set<string>;
  counts: {
    groups: number;
    sections: number;
    storages: number;
    priceTypes: number;
    products: number;
    prices: number;
    stockLines: number;
    stockExpectedLines: number;
    quarantine: number;
    quarantineReasonCounts?: Record<string, number>;
  };
};

export type CatalogImportStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "VALIDATION_FAILED"
  | "HASH_MISMATCH"
  | "UNSTABLE_SOURCE"
  | "IMPORT_LOCKED"
  | "SKIPPED_UNCHANGED"
  | "RECORD_COUNT_DECREASED"
  | "PRODUCT_CODE_LOSS"
  | "ARGUMENT_ERROR"
  | "CONFIG_ERROR"
  | "FTP_ERROR"
  | "READ_FAILED"
  | "TIMEOUT"
  | "DATABASE_ERROR"
  | "COMMIT_UNCERTAIN"
  | "APPLY_BLOCKED";

export type CatalogImportResult = {
  status: CatalogImportStatus;
  mode: CatalogImportMode;
  runId?: string;
  durationMs: number;
  manifestSha256?: string;
  totalByteSize?: number;
  coreApplied?: boolean;
  commercialReady?: boolean;
  appliedVersionId?: string;
  counts?: ParsedCatalogSet["counts"];
  newProducts?: number;
  changedProducts?: number;
  missingFromSnapshot?: number;
  quarantineCount?: number;
  errorCount?: number;
  warningCount?: number;
  errors?: ValidationIssue[];
  warnings?: SchemaDriftWarning[];
  quarantine?: QuarantineEntry[];
  errorsTruncated?: boolean;
  warningsTruncated?: boolean;
  quarantineTruncated?: boolean;
  message: string;
  errorCode?: string;
  readAt?: string;
};

export type CatalogImportCliOptions = {
  mode: CatalogImportMode;
  expectedManifestSha256?: string;
  localDir?: string;
};
