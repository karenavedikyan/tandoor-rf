import type { AccessContext } from "../access/types";

/** Confirmed 1C employee guid for the logged-in ROP session; null when not applicable. */
export function selfRopEmployeeGuidFromContext(context: AccessContext): string | null {
  if (context.role !== "rop") {
    return null;
  }
  if (!context.hasEmployeeLink || context.employeeLinkConflict || !context.employeeId) {
    return null;
  }
  return context.employeeId;
}
