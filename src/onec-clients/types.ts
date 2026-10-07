export const IMPORT_STATUSES = [
  "SUCCESS",
  "VALIDATION_FAILED",
  "CONFIG_ERROR",
  "FTP_ERROR",
  "TIMEOUT",
  "HASH_MISMATCH",
  "RECORD_COUNT_DECREASED",
  "GUID_SET_SHRINK",
  "ROSTER_SHRINK_AMBIGUOUS",
  "IMPORT_LOCKED",
  "STALE_RUNNING_IMPORT",
  "DATABASE_ERROR",
  "COMMIT_UNCERTAIN",
  "SUPERSEDED_BY_NEWER_IMPORT",
  "APPLY_BLOCKED",
  "ARGUMENT_ERROR",
  "IMPORT_JOB_SUPERSEDED",
  "NIGHTLY_WINDOW_MISSED",
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
  | "EMPTY_TELEPHONE"
  | "UNCONFIRMED_OUTLET_GUID"
  | "UNCONFIRMED_CLOSURE_STATUS"
  | "OUTLETS_NOT_NORMALIZED"
  | "EMPLOYEE_DIRECTORY_UNAVAILABLE";

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
  /** Set during validation when employee roster is loaded; apply must not recompute from a separate roster object. */
  managerRosterState?: import("./extended-types").ClientManagerRosterState;
};

export type ExtendedContractVerification = "synthetic_confirmed" | "operator_confirmed" | "unverified";

export type ValidatedClientsPayload = {
  sha256: string;
  byteSize: number;
  recordCount: number;
  records: ParsedClientRecord[];
  warnings: ValidationWarning[];
  warningCount: number;
  sourceFormat?: import("./extended-types").ClientsSourceFormat;
  extendedRecords?: import("./extended-types").ParsedExtendedClientRecord[];
  extendedDiagnostics?: import("./extended-types").ExtendedDiagnosticsSummary;
  extendedContractVerification?: ExtendedContractVerification;
  holdingLinkValidationPolicy?: import("./holding-link-policy").HoldingLinkValidationPolicy;
  employeeRosterSourceSha256?: string | null;
  wholesaleCompositionMode?: import("./wholesale-composition").WholesaleCompositionMode;
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
  issueCodes?: string[];
  warningCodes?: string[];
  extendedDiagnostics?: import("./extended-types").ExtendedDiagnosticsSummary | null;
  wholesaleCompositionPrep?: import("./wholesale-composition").WholesaleCompositionPrepReport;
  holdingLinkValidationPolicy?: import("./holding-link-policy").HoldingLinkValidationPolicy;
  verificationFingerprint?: string;
  message: string;
  cleanupWarning?: string;
  apply?: {
    runId?: string;
    newCount?: number;
    changedCount?: number;
    unchangedCount?: number;
    extendedBlockedCount?: number;
    extendedAppliedCount?: number;
    extendedApplied?: boolean;
    extendedBlockReason?: string;
    outletParentLinkConflicts?: number;
  };
  errorCode?: string;
};

export type ClientsImportCliOptions = {
  mode: ClientsImportMode;
  expectedSha256?: string;
  holdingLinkValidationPolicy?: import("./holding-link-policy").HoldingLinkValidationPolicy;
  wholesaleCompositionPrep?: boolean;
  employeeRosterFile?: string;
};

export type { WholesaleCompositionPrepReport } from "./wholesale-composition";
