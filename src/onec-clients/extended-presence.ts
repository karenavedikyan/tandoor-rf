import { isDeepStrictEqual } from "node:util";
import type {
  ExtendedSnapshot,
  ParsedManagerRef,
  ParsedRetailOutlet,
} from "./extended-types";
import { outletBusinessProjection, type OutletBusinessProjection } from "./outlet-identity";

export type FieldPresenceState = "missing" | "present" | "explicit_empty" | "explicit_null";

export type ExtendedRecordFieldPresence = {
  holding: FieldPresenceState;
  retailOutlets: FieldPresenceState;
  regionalManager: FieldPresenceState;
  hardwareManager: FieldPresenceState;
  headOfSales: FieldPresenceState;
};

export type ExtendedBusinessProjection = {
  isHolding: boolean | null;
  regionalManager: Pick<ParsedManagerRef, "guid" | "name" | "state">;
  hardwareManager: Pick<ParsedManagerRef, "guid" | "name" | "state">;
  headOfSales: Pick<ParsedManagerRef, "guid" | "name" | "state">;
  commercial: import("./commercial-fields").SnapshotCommercial | null;
  wholesaleExchange: import("./wholesale-client-exchange-fields").SnapshotWholesaleClientExchange | null;
  currentRetailOutlets: OutletBusinessProjection[];
};

function managerBusinessRef(ref: ParsedManagerRef): Pick<ParsedManagerRef, "guid" | "name" | "state"> {
  return { guid: ref.guid, name: ref.name, state: ref.state };
}

export function extendedBusinessProjection(snapshot: ExtendedSnapshot | null): ExtendedBusinessProjection | null {
  if (!snapshot) {
    return null;
  }
  return {
    isHolding: snapshot.isHolding,
    regionalManager: managerBusinessRef(snapshot.regionalManager),
    hardwareManager: managerBusinessRef(snapshot.hardwareManager),
    headOfSales: managerBusinessRef(snapshot.headOfSales),
    commercial: snapshot.commercial ?? null,
    wholesaleExchange: snapshot.wholesaleExchange ?? null,
    currentRetailOutlets: snapshot.currentRetailOutlets.map(outletBusinessProjection),
  };
}

export function extendedBusinessDataEqual(
  left: ExtendedSnapshot | null,
  right: ExtendedSnapshot | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return isDeepStrictEqual(extendedBusinessProjection(left), extendedBusinessProjection(right));
}

export function mergeManagerField(
  incoming: ParsedManagerRef,
  presence: FieldPresenceState,
  previous: ParsedManagerRef | undefined,
  isNewClient: boolean,
): ParsedManagerRef {
  if (presence === "missing") {
    if (previous) {
      return previous;
    }
    return { guid: null, name: "", state: "not_provided" };
  }
  if (presence === "explicit_null") {
    return { guid: null, name: "", state: "not_provided" };
  }
  void isNewClient;
  return incoming;
}

export function mergeRetailOutlets(
  incoming: ParsedRetailOutlet[],
  presence: FieldPresenceState,
  previous: ParsedRetailOutlet[] | undefined,
): ParsedRetailOutlet[] {
  if (presence === "missing" && previous) {
    return previous;
  }
  if (presence === "explicit_null") {
    return [];
  }
  return incoming;
}

export function mergeHoldingFlag(
  incoming: boolean | null,
  presence: FieldPresenceState,
  previous: boolean | null | undefined,
): boolean | null {
  if (presence === "missing" && previous !== undefined) {
    return previous ?? null;
  }
  return incoming;
}

export function blockFreshnessForPresence(
  presence: FieldPresenceState,
  hasPrevious: boolean,
): "current" | "preserved_from_previous" | "not_provided_in_snapshot" {
  if (presence === "missing") {
    return hasPrevious ? "preserved_from_previous" : "not_provided_in_snapshot";
  }
  if (presence === "explicit_empty" || presence === "present") {
    return "current";
  }
  return "not_provided_in_snapshot";
}
