/** Organizational role overrides by confirmed 1C employee GUID (lowercase). */
export const ORG_DIRECTOR_EMPLOYEE_GUID = (
  process.env.TANDOOR_ORG_DIRECTOR_EMPLOYEE_GUID ??
  "a2bacfab-ebec-11e3-a1dd-08606e7fce4d"
).trim().toLowerCase();

/** Roster post label used to discover ROP candidates when assignments are absent. */
export const ROSTER_ROP_POST_LABEL = "Руководитель отдела продаж";

/** Optional 1C employee GUID for the assistants department head (ROA). */
export const ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID = (
  process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID ?? ""
)
  .trim()
  .toLowerCase() || null;

/** Legacy env flag; team membership is confirmed only from roster post «Ассистент». */
export const ORG_ASSISTANTS_HEAD_IN_TEAM =
  (process.env.TANDOOR_ORG_ASSISTANTS_HEAD_IN_TEAM ?? "").trim() === "1";

/** Roster post label for the assistants department head when env GUID is absent. */
export const ROSTER_ASSISTANTS_HEAD_POST_LABEL = "Руководитель отдела ассистентов";

/** Roster post label for assistants department team members. */
export const ROSTER_ASSISTANT_MEMBER_POST_LABEL = "Ассистент";

/** URL expand token for the assistants department block in compact teams UI. */
export const ASSISTANTS_DEPT_EXPAND_TOKEN = "__assistants_dept__";

export type OrgStructureNodeKind =
  | "director"
  | "rop"
  | "roa"
  | "assistant"
  | "manager"
  | "regional"
  | "hardware"
  | "undefined_team";

export type AssistantsMemberRole = "roa" | "assistant";

export type AssignmentEntityKind = "client" | "outlet";
