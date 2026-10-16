import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";

export type V3TypeCategory = {
  guidType: string;
  nameType: string;
  guidCategory: string;
  nameCategory: string;
};

export type V3Managers = {
  guidManager: string | null;
  nameManager: string | null;
  guidRegionalManager: string | null;
  nameRegionalManager: string | null;
  guidHardwareManager: string | null;
  nameHardwareManager: string | null;
  guidHeadOfSales: string | null;
  nameHeadOfSales: string | null;
};

export type V3ValidatedHolding = {
  guidHolding: string;
  nameHolding: string;
  typeCategory: V3TypeCategory;
  retailChain: boolean;
  holdingGroup: boolean;
  managers: V3Managers;
  legalEntities: Array<{ guidRetail: string; nameRetail: string; zeroGuid: boolean }>;
  retailOutlets: Array<{ guidRetail: string; nameRetail: string; zeroGuid: boolean }>;
};

export type V3ValidatedLegal = {
  guidClient: string;
  nameClient: string;
  inn: string | null;
  kpp: string | null;
  guidHolding: string | null;
  nameHolding: string | null;
  typeCategory: V3TypeCategory;
  managers: V3Managers;
  address: string;
  telephone: string[];
  discount: string;
  discountAmount: number;
  markups: Array<{ guid: string; name: string; percentage: number }>;
  otherFields: Record<string, unknown>;
  membershipConflict: boolean;
};

export type V3ValidatedRetail = {
  guidStore: string;
  guidHolding: string | null;
  warehouse: boolean;
  closed: boolean;
  typeCategory: V3TypeCategory;
  address: Record<string, unknown>;
  informationLoading: Record<string, unknown>;
  managers: V3Managers;
  contactInformation: Record<string, unknown>;
  lprInformation: Record<string, unknown>;
  additionalInformation: Record<string, unknown>;
  membershipConflict: boolean;
};

export type V3ValidatedBundle = {
  holdings: V3ValidatedHolding[];
  legalEntities: V3ValidatedLegal[];
  retailOutlets: V3ValidatedRetail[];
  employeeRoster: WholesaleEmployeeRoster;
  fileSha256: Record<string, string>;
  bundleFingerprint: string;
  warnings: string[];
};

export type V3ImportMode = "dry_run" | "apply";

export type V3ImportResult = {
  status: "SUCCESS" | "REJECTED" | "ERROR" | "NO_CHANGES";
  mode: V3ImportMode;
  bundleFingerprint?: string;
  message?: string;
  errorCode?: string;
  counts?: {
    holdings: number;
    legalEntities: number;
    retailOutlets: number;
    employees: number;
  };
  warnings?: string[];
};
