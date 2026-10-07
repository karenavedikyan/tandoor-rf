/** Assignment presence mode for extended snapshot manager refs. */
export type AssignmentPresenceMode = "assigned" | "unassigned" | "not_provided";

export function parseAssignmentPresenceMode(value: unknown): AssignmentPresenceMode | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return null;
  }
  const raw = String(value).trim().toLowerCase();
  if (raw === "assigned" || raw === "unassigned" || raw === "not_provided") {
    return raw;
  }
  return null;
}

export function parseUuidListParam(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  const parts = Array.isArray(value) ? value : String(value).split(",");
  const guids: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined) {
      continue;
    }
    if (typeof part !== "string" && typeof part !== "number") {
      return null;
    }
    const trimmed = String(part).trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(trimmed)) {
      return null;
    }
    guids.push(trimmed);
  }
  return guids;
}

export function guidListMatchClause(guidExpr: string, paramSql: string): string {
  return `lower(${guidExpr}) = ANY(SELECT lower(g::text) FROM unnest(${paramSql}::uuid[]) g)`;
}

export function extendedRefPresenceClause(refPath: string, mode: AssignmentPresenceMode): string {
  const guidPath = `${refPath}->>'guid'`;
  const statePath = `COALESCE(${refPath}->>'state', '')`;
  if (mode === "assigned") {
    return `(NULLIF(BTRIM(lower(${guidPath})), '') IS NOT NULL AND ${statePath} NOT IN ('unassigned', 'invalid', 'not_provided'))`;
  }
  if (mode === "unassigned") {
    return `(${statePath} = 'unassigned' OR (NULLIF(BTRIM(${guidPath}), '') IS NULL AND ${statePath} IN ('unassigned', 'invalid')))`;
  }
  return `${statePath} = 'not_provided'`;
}

export function legacyClientManagerPresenceClause(mode: AssignmentPresenceMode): string {
  if (mode === "assigned") {
    return `NULLIF(BTRIM(lower(onec_clients.guid_manager::text)), '00000000-0000-0000-0000-000000000000') IS NOT NULL`;
  }
  if (mode === "unassigned") {
    return `NULLIF(BTRIM(lower(onec_clients.guid_manager::text)), '00000000-0000-0000-0000-000000000000') IS NULL`;
  }
  return "FALSE";
}
