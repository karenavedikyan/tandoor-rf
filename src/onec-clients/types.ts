export const IMPORT_STATUSES = [
  "SUCCESS",
  "VALIDATION_FAILED",
  "CONFIG_ERROR",
  "FTP_ERROR",
  "TIMEOUT",
  "HASH_MISMATCH",
  "RECORD_COUNT_DECREASED",
  "IMPORT_LOCKED",
  "STALE_RUNNING_IMPORT",
  "DATABASE_ERROR",
  "ARGUMENT_ERROR",
] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export type ValidationIssueCode =
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "EMPTY_ARRAY"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_RECORDS"
  | "NULL_RECORD"
  | "MISSING_FIELD"
  | "INVALID_TYPE"
  | "INVALID_UUID"
  | "EMPTY_NAME"
  | "HOLDING_CONTRACT"
  | "DUPLICATE_CLIENT"
  | "EXTRA_FIELDS";

export type ValidationIssue = {
  code: ValidationIssueCode;
  field?: string;
  index?: number;
};

export type ValidationWarningCode =
  | "EXTRA_FIELDS"
  | "EMPTY_ADDRESS"
  | "EMPTY_TELEPHONE";

export type ValidationWarning = {
  code: ValidationWarningCode;
  field?: string;
  index?: number;
  extraFieldCount?: number;
};

export type ParsedClientRecord = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: string[];
};

export type ValidatedClientsPayload = {
  sha256: string;
  byteSize: number;
  recordCount: number;
  records: ParsedClientRecord[];
  warnings: ValidationWarning[];
};

export type ClientsImportMode = "dry_run" | "apply";

export type ClientsImportResult = {
  status: ImportStatus;
  mode: ClientsImportMode;
  durationMs: number;
  security: "plain";
  transportWarning: string;
  sha256?: string;
  byteSize?: number;
  recordCount?: number;
  errorCount?: number;
  warningCount?: number;
  errors?: ValidationIssue[];
  warnings?: ValidationWarning[];
  errorsTruncated?: boolean;
  warningsTruncated?: boolean;
  message: string;
  apply?: {
    runId?: string;
    newCount?: number;
    changedCount?: number;
    unchangedCount?: number;
  };
  errorCode?: string;
};

export type ClientsImportCliOptions = {
  mode: ClientsImportMode;
  expectedSha256?: string;
};
