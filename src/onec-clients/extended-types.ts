export type ClientsSourceFormat = "legacy" | "extended_v1";

export type ManagerAssignmentState = "unassigned" | "assigned" | "unmatched" | "invalid";

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

export type ParsedRetailOutlet = {
  ordinal: number;
  holdingName: string;
  warehouse: boolean | null;
  address: ParsedOutletAddress;
  loading: ParsedOutletLoading;
  managers: ParsedOutletManagers;
  contacts: ParsedOutletContacts;
  lpr: ParsedOutletLpr;
  additional: ParsedOutletAdditional;
  outletGuidStatus: "not_provided";
  closureStatus: "not_provided";
  distributionAllowed: false;
  presentInCurrentSnapshot: boolean;
};

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
};

export type ExtendedValidationIssueCode =
  | "INVALID_HOLDING_BOOLEAN"
  | "INVALID_RETAIL_OUTLETS"
  | "INVALID_OUTLET_SHAPE"
  | "INVALID_OUTLET_FIELD"
  | "INVALID_MANAGER_PAIR"
  | "HOLDING_GUID_UNKNOWN"
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
  | "OUTLETS_NOT_NORMALIZED";

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
  outletsWithoutGuid: number;
  unconfirmedClosureStatusCount: number;
  unmatchedManagerGuidCount: number;
  holdingLinkErrors: number;
  recordsWithExtendedFields: number;
  legacyOnlyRecords: number;
  blocks: {
    legacyImportReady: boolean;
    clientExtendedReady: boolean;
    outletNormalizedReady: false;
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
};
