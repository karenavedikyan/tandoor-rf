import type { AccessContext } from "../access/types";
import type { ParsedRetailOutlet } from "../onec-clients/extended-types";

export const MAX_OUTLETS_IN_DETAIL_RESPONSE = 20;

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
  if (!isActiveScopedReader(context)) {
    return false;
  }
  if (context.role === "admin") {
    return true;
  }
  if (context.role === "director" && context.fullClientBase) {
    return true;
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

/**
 * Filters outlet rows to those visible in list/card for the current role.
 * Does not grant client access by itself — caller must already enforce client scope.
 */
export function filterRetailOutletsForContext(
  context: AccessContext,
  clientManagerGuid: string,
  outlets: ParsedRetailOutlet[],
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
    if (context.employeeId.toLowerCase() !== clientManagerGuid.toLowerCase()) {
      return [];
    }
    return outlets;
  }

  if (context.role === "regional_manager" && context.employeeId) {
    const employeeId = context.employeeId.toLowerCase();
    return outlets.filter((outlet) => {
      const regionalGuid = outlet.managers.regionalManager.guid?.toLowerCase() ?? "";
      return regionalGuid === employeeId && confirmedOutletGuid(outlet) !== null;
    });
  }

  if (context.role === "rop") {
    return outlets;
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
): number {
  return filterRetailOutletsForContext(context, clientManagerGuid, outlets).length;
}
