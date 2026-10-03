export type ClientsSourceFormat = "legacy" | "extended_v1";

export type ManagerAssignmentState =
  | "not_provided"
  | "unassigned"
  | "invalid"
  | "directory_unverified"
  | "directory_unverified_account_linked";

export type ParsedManagerRef = {
  guid: string | null;
  name: string;
  state: ManagerAssignmentState;
};

export type ParsedOutletAddress = {
  storeAddress: string;
  deliveryAddress: string;
  routeDirection: string;
};

export type ParsedOutletLoading = {
  loadingOnMonday: boolean | null;
  loadingOnTuesday: boolean | null;
  loadingOnWednesday: boolean | null;
  loadingOnThursday: boolean | null;
  loadingOnFriday: boolean | null;
  loadingOnSaturday: boolean | null;
  loadingOnSunday: boolean | null;
  loadingTime: string | null;
};

export type ParsedOutletManagers = {
  manager: ParsedManagerRef;
  regionalManager: ParsedManagerRef;
  hardwareManager: ParsedManagerRef;
  headOfSales: ParsedManagerRef;
};

export type ParsedOutletContacts = {
  storePhone: string;
  accountantPhone: string;
  accountantEmail: string;
};

export type ParsedOutletLpr = {
  name: string;
  post: string;
  dateOfBirth: string | null;
  phone: string;
  email: string;
  bonus: string;
  conditionsBonus: string;
};

export type ParsedOutletAdditional = {
  statusTandoorClub: string;
  bonusTandoorClub: string;
};

export type OutletGuidStatus = "confirmed" | "not_provided" | "invalid";

export type OutletClosureStatus = "open" | "closed" | "not_provided" | "invalid";

export type RetailOutletClosureHistoryEntry = {
  closed: boolean;
  sourceSha256: string;
  capturedAt: string;
};

export type OutletFreshnessState =
  | "current"
  | "preserved_from_previous"
  | "absent_from_current_export"
  | "not_provided_in_snapshot";

export type OutletProvenance = {
  freshness: OutletFreshnessState;
  sourceSha256: string;
  importedAt: string;
};

export type ParsedRetailOutlet = {
  /** Position in the current source array; display order only when guid_store absent. */
  ordinal: number;
  /** Stable 1C identity when guid_store is confirmed in the source file. */
  guidStore: string | null;
  holdingName: string;
  warehouse: boolean | null;
  address: ParsedOutletAddress;
  loading: ParsedOutletLoading;
  managers: ParsedOutletManagers;
  contacts: ParsedOutletContacts;
  lpr: ParsedOutletLpr;
  additional: ParsedOutletAdditional;
  outletGuidStatus: OutletGuidStatus;
  /** Confirmed closure value when closureStatus is open/closed. */
  closed: boolean | null;
  closureStatus: OutletClosureStatus;
  /** Whether closed was explicitly present in the current source row. */
  closureConfirmedInCurrentExport: boolean;
  closureHistory: RetailOutletClosureHistoryEntry[];
  provenance: OutletProvenance;
  distributionAllowed: false;
};

export type RetailOutletHistoryEntry = {
  sourceSha256: string;
  capturedAt: string;
  retailOutlets: ParsedRetailOutlet[];
};

export type ExtendedBlockFreshness = {
  holding: ExtendedFreshnessState;
  regionalManager: ExtendedFreshnessState;
  hardwareManager: ExtendedFreshnessState;
  headOfSales: ExtendedFreshnessState;
  retailOutlets: ExtendedFreshnessState;
};

export type ExtendedBlockProvenanceEntry = {
  freshness: ExtendedFreshnessState;
  sourceSha256: string;
  importedAt: string;
};

export type ExtendedBlockProvenance = {
  holding: ExtendedBlockProvenanceEntry;
  regionalManager: ExtendedBlockProvenanceEntry;
  hardwareManager: ExtendedBlockProvenanceEntry;
  headOfSales: ExtendedBlockProvenanceEntry;
  retailOutlets: ExtendedBlockProvenanceEntry;
};

export type ExtendedSnapshotBlocks = {
  clientExtendedReady: boolean;
  outletNormalizedReady: boolean;
  clientExtendedBlockedReason?: string | null;
  blockFreshness?: ExtendedBlockFreshness;
  blockProvenance?: ExtendedBlockProvenance;
};

export type ExtendedSnapshot = {
  formatVersion: "extended_v1";
  sourceSha256: string;
  importedAt: string;
  isHolding: boolean | null;
  regionalManager: ParsedManagerRef;
  hardwareManager: ParsedManagerRef;
  headOfSales: ParsedManagerRef;
  currentRetailOutlets: ParsedRetailOutlet[];
  retailOutletHistory: RetailOutletHistoryEntry[];
  blocks: ExtendedSnapshotBlocks;
};

export type ExtendedFreshnessState =
  | "current"
  | "preserved_from_previous"
  | "not_provided_in_snapshot";

export type ParsedExtendedClientRecord = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: string[];
  isHolding: boolean | null;
  regionalManager: ParsedManagerRef;
  hardwareManager: ParsedManagerRef;
  headOfSales: ParsedManagerRef;
  retailOutlets: ParsedRetailOutlet[];
  recordFormat: "legacy" | "extended_v1";
  hasExtendedManagerFields: boolean;
  fieldPresence: import("./extended-presence").ExtendedRecordFieldPresence;
};

export type ExtendedValidationIssueCode =
  | "INVALID_HOLDING_BOOLEAN"
  | "INVALID_RETAIL_OUTLETS"
  | "INVALID_OUTLET_SHAPE"
  | "INVALID_OUTLET_FIELD"
  | "INVALID_OUTLET_GUID"
  | "INVALID_OUTLET_CLOSED"
  | "DUPLICATE_OUTLET_GUID"
  | "OUTLET_GUID_CONFLICT"
  | "INVALID_MANAGER_PAIR"
  | "INVALID_MANAGER_GUID"
  | "HOLDING_GUID_UNKNOWN"
  | "HOLDING_TARGET_NOT_HOLDING_CARD"
  | "HOLDING_SELF_REFERENCE"
  | "HOLDING_CYCLE"
  | "MIXED_FORMAT_FILE";

export type ExtendedValidationIssue = {
  code: ExtendedValidationIssueCode | import("./types").ValidationIssueCode;
  field?: string;
  index?: number;
  outletIndex?: number;
};

export type ExtendedValidationWarningCode =
  | "UNCONFIRMED_OUTLET_GUID"
  | "UNCONFIRMED_CLOSURE_STATUS"
  | "OUTLETS_NOT_NORMALIZED"
  | "DUPLICATE_OUTLET_GUID_ROW"
  | "EMPLOYEE_DIRECTORY_UNAVAILABLE";

export type ExtendedValidationWarning = {
  code: ExtendedValidationWarningCode | import("./types").ValidationWarningCode;
  field?: string;
  index?: number;
  outletIndex?: number;
  extraFieldCount?: number;
};

export type ExtendedDiagnosticsSummary = {
  sourceFormat: ClientsSourceFormat;
  holdingCardCount: number;
  childHoldingLinkCount: number;
  nestedOutletCount: number;
  outletsWithGuid: number;
  outletsWithoutGuid: number;
  outletsOpen: number;
  outletsClosed: number;
  outletsUnknownClosure: number;
  outletSourceRowCount: number;
  outletUniqueGuidCount: number;
  duplicateOutletGuidCount: number;
  outletParentLinkConflicts: number;
  /** null = registry comparison not performed (validate-only path). */
  knownOutletsMissingFromSnapshot: number | null;
  invalidManagerGuidCount: number;
  employeeDirectoryVerified: false;
  holdingLinkErrors: number;
  recordsWithExtendedFields: number;
  legacyOnlyRecords: number;
  blocks: {
    legacyImportReady: boolean;
    clientExtendedReady: boolean;
    /** All parsed outlets have guid_store and closed; does not imply live/production readiness. */
    outletFieldsComplete: boolean;
    outletNormalizedReady: boolean;
  };
};

export type ValidatedExtendedClientsPayload = {
  sha256: string;
  byteSize: number;
  recordCount: number;
  sourceFormat: ClientsSourceFormat;
  records: ParsedExtendedClientRecord[];
  warnings: ExtendedValidationWarning[];
  warningCount: number;
  diagnostics: ExtendedDiagnosticsSummary;
  extendedContractVerification?: import("./types").ExtendedContractVerification;
};
