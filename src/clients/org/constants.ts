/** Organizational role overrides by confirmed 1C employee GUID (lowercase). */
export const ORG_DIRECTOR_EMPLOYEE_GUID = (
  process.env.TANDOOR_ORG_DIRECTOR_EMPLOYEE_GUID ??
  "a2bacfab-ebec-11e3-a1dd-08606e7fce4d"
).trim().toLowerCase();

/** Roster post label used to discover ROP candidates when assignments are absent. */
export const ROSTER_ROP_POST_LABEL = "Руководитель отдела продаж";

export type OrgStructureNodeKind = "director" | "rop" | "manager" | "regional" | "hardware" | "undefined_team";

export type AssignmentEntityKind = "client" | "outlet";
