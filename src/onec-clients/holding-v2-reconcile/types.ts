import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "../extended-types";

export type HoldingV2DesiredLegalLink = {
  guidClient: string;
  guidHoldingRoot: string;
  isHoldingHead: boolean;
};

export type HoldingV2DesiredOutletLink = {
  guidStore: string;
  guidHoldingRoot: string;
  isClosed: boolean | null;
  closureKnown: boolean;
  outlet: ParsedRetailOutlet;
};

export type HoldingV2DesiredTypeCategoryPatch = {
  scope: "client" | "outlet";
  key: string;
  objectPresentInSource: boolean;
  fieldPresence: {
    guidType: boolean;
    nameType: boolean;
    guidCategory: boolean;
    nameCategory: boolean;
  };
  guidType: string | null;
  nameType: string | null;
  guidCategory: string | null;
  nameCategory: string | null;
};

export type HoldingV2DesiredSnapshot = {
  sourceSha256: string;
  /** Holdings present in file with validated head (reconciliation scope). */
  holdingsInSnapshot: string[];
  /** Holdings where membership/outlet list is authoritative for link removal. */
  membershipCompleteHoldings: Set<string>;
  legalLinks: HoldingV2DesiredLegalLink[];
  outletLinks: HoldingV2DesiredOutletLink[];
  typeCategoryPatches: HoldingV2DesiredTypeCategoryPatch[];
  recordsByClient: Map<string, ParsedExtendedClientRecord>;
};

export type HoldingV2PersistedLegalLink = {
  guidClient: string;
  guidHoldingRoot: string;
  isHoldingHead: boolean;
  linkActive: boolean;
};

export type HoldingV2PersistedOutletLink = {
  guidStore: string;
  guidHoldingRoot: string;
  isClosed: boolean | null;
  closureKnown: boolean;
  linkActive: boolean;
};

export type HoldingV2PersistedState = {
  legalLinks: HoldingV2PersistedLegalLink[];
  outletLinks: HoldingV2PersistedOutletLink[];
  clientTypeCategories: Array<{
    guidClient: string;
    objectPresentInSource: boolean;
    fieldPresence: Record<string, boolean>;
    guidType: string | null;
    nameType: string | null;
    guidCategory: string | null;
    nameCategory: string | null;
  }>;
  outletTypeCategories: Array<{
    guidStore: string;
    objectPresentInSource: boolean;
    fieldPresence: Record<string, boolean>;
    guidType: string | null;
    nameType: string | null;
    guidCategory: string | null;
    nameCategory: string | null;
  }>;
};

export type HoldingV2ReconcileApplyResult =
  | {
      ok: true;
      code: "SUCCESS" | "NO_CHANGES";
      normalizedStateSha256: string;
      legalLinksWritten: number;
      outletLinksWritten: number;
      typeCategoryWritten: number;
      runId: string;
    }
  | {
      ok: false;
      code:
        | "INVALID_PAYLOAD"
        | "RECONCILE_LOCKED"
        | "INVARIANT_VIOLATION"
        | "CLIENT_STUB_MISSING"
        | "OUTLET_COMPOSITION_INCOMPLETE"
        | "ORPHAN_HOLDING_LINKS"
        | "TYPE_CATEGORY_EXPLICIT_NULL"
        | "DATABASE_ERROR"
        | "FAILED";
      message: string;
      runId?: string;
    };
