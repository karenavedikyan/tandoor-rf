import type { AccessContext } from "../access/types";
import type {
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "../onec-clients/extended-types";

export const MAX_OUTLETS_IN_DETAIL_RESPONSE = 20;

export type OutletFilterOptions = {
  clientHeadOfSalesGuid?: string | null;
  ropTeamEmployeeGuids?: ReadonlySet<string> | null;
};

function isActiveScopedReader(context: AccessContext): boolean {
  return (
    context.status === "active" &&
    context.hasScopedClientAccess &&
    !context.explicitlyDeniedAll &&
    !context.employeeLinkConflict
  );
}

/**
 * Whether nested retail outlets may appear on the client card for this role.
 * Card-level client access is enforced separately; this gate only controls outlet payload.
 */
export function canReadNestedRetailOutlets(context: AccessContext): boolean {
  if (context.status !== "active" || context.explicitlyDeniedAll || context.employeeLinkConflict) {
    return false;
  }
  if (context.role === "admin") {
    return true;
  }
  if (context.role === "director" && context.fullClientBase) {
    return true;
  }
  if (!isActiveScopedReader(context)) {
    return false;
  }
  if (context.role === "manager" || context.role === "regional_manager" || context.role === "rop") {
    return context.hasEmployeeLink;
  }
  if (context.role === "assistant") {
    return true;
  }
  return false;
}

function confirmedOutletGuid(outlet: ParsedRetailOutlet): string | null {
  if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
    return null;
  }
  return outlet.guidStore.toLowerCase();
}

function normalizeGuid(guid: string | null | undefined): string | null {
  if (!guid) {
    return null;
  }
  const trimmed = guid.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function isOutletExplicitlyAssignedToOtherManager(
  outlet: ParsedRetailOutlet,
  employeeId: string,
): boolean {
  const outletManager = normalizeGuid(outlet.managers.manager.guid);
  if (!outletManager || outletManager === employeeId) {
    return false;
  }
  const state = outlet.managers.manager.state;
  return state !== "unassigned" && state !== "invalid" && state !== "not_provided";
}

function filterManagerRetailOutlets(
  employeeId: string,
  clientManagerGuid: string,
  outlets: ParsedRetailOutlet[],
): ParsedRetailOutlet[] {
  const clientManager = normalizeGuid(clientManagerGuid);
  return outlets.filter((outlet) => {
    const outletManager = normalizeGuid(outlet.managers.manager.guid);
    if (outletManager === employeeId) {
      return true;
    }
    if (clientManager === employeeId) {
      return !isOutletExplicitlyAssignedToOtherManager(outlet, employeeId);
    }
    return false;
  });
}

function filterRopRetailOutlets(
  context: AccessContext,
  clientManagerGuid: string,
  outlets: ParsedRetailOutlet[],
  options?: OutletFilterOptions,
): ParsedRetailOutlet[] {
  const employeeId = normalizeGuid(context.employeeId);
  if (!employeeId) {
    return [];
  }

  const clientHead = normalizeGuid(options?.clientHeadOfSalesGuid);
  const teamGuids = new Set(options?.ropTeamEmployeeGuids ?? []);
  teamGuids.add(employeeId);

  const managerGuid = normalizeGuid(clientManagerGuid);
  if (managerGuid && teamGuids.has(managerGuid)) {
    return outlets;
  }

  return outlets.filter((outlet) => {
    const outletHead = normalizeGuid(outlet.managers.headOfSales.guid);
    if (outletHead === employeeId) {
      return true;
    }
    if (outletHead && outletHead !== employeeId) {
      return false;
    }
    const regionalGuid = normalizeGuid(outlet.managers.regionalManager.guid);
    if (regionalGuid !== null && teamGuids.has(regionalGuid)) {
      return true;
    }
    return clientHead === employeeId;
  });
}

/**
 * Filters outlet rows to those visible in list/card for the current role.
 * Does not grant client access by itself — caller must already enforce client scope.
 */
export function filterRetailOutletsForContext(
  context: AccessContext,
  clientManagerGuid: string,
  outlets: ParsedRetailOutlet[],
  options?: OutletFilterOptions,
): ParsedRetailOutlet[] {
  if (!canReadNestedRetailOutlets(context)) {
    return [];
  }

  if (context.role === "admin") {
    return outlets;
  }
  if (context.role === "director" && context.fullClientBase) {
    return outlets;
  }

  if (context.role === "manager" && context.employeeId) {
    const employeeId = normalizeGuid(context.employeeId);
    if (!employeeId) {
      return [];
    }
    return filterManagerRetailOutlets(employeeId, clientManagerGuid, outlets);
  }

  if (context.role === "regional_manager" && context.employeeId) {
    const employeeId = context.employeeId.toLowerCase();
    return outlets.filter((outlet) => {
      const regionalGuid = outlet.managers.regionalManager.guid?.toLowerCase() ?? "";
      return regionalGuid === employeeId && confirmedOutletGuid(outlet) !== null;
    });
  }

  if (context.role === "rop") {
    return filterRopRetailOutlets(context, clientManagerGuid, outlets, options);
  }

  if (context.role === "assistant") {
    return outlets;
  }

  return [];
}

export function countVisibleRetailOutletsForContext(
  context: AccessContext,
  clientManagerGuid: string,
  outlets: ParsedRetailOutlet[],
  options?: OutletFilterOptions,
): number {
  return filterRetailOutletsForContext(context, clientManagerGuid, outlets, options).length;
}

function hasUnscopedOutletHistoryAccess(context: AccessContext): boolean {
  if (context.role === "admin") {
    return true;
  }
  if (context.role === "director" && context.fullClientBase) {
    return true;
  }
  if (context.role === "assistant") {
    return true;
  }
  return false;
}

/**
 * Counts history entries safe to expose for the current role.
 * Returns 0 when scope filtering cannot safely bound the payload.
 */
export function countVisibleRetailOutletHistoryForContext(
  context: AccessContext,
  clientManagerGuid: string,
  history: RetailOutletHistoryEntry[],
  options?: OutletFilterOptions,
): number {
  if (!canReadNestedRetailOutlets(context) || history.length === 0) {
    return 0;
  }
  if (hasUnscopedOutletHistoryAccess(context)) {
    return history.length;
  }
  if (
    context.role !== "manager" &&
    context.role !== "regional_manager" &&
    context.role !== "rop"
  ) {
    return 0;
  }

  let visibleEntryCount = 0;
  for (const entry of history) {
    const outlets = Array.isArray(entry.retailOutlets) ? entry.retailOutlets : [];
    const visibleOutlets = filterRetailOutletsForContext(
      context,
      clientManagerGuid,
      outlets,
      options,
    );
    if (visibleOutlets.length > 0) {
      visibleEntryCount += 1;
    }
  }
  return visibleEntryCount;
}
