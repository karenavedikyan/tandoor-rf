import { outletsJsonArraySql } from "./outlets/scope-sql";

/**
 * Client list: outlet-level conditions must match on a single accessible outlet row.
 * Scope is enforced separately; this only constrains sibling outlet fields.
 */
export function clientHasOutletMatchingSql(outletConditions: string[]): string {
  if (outletConditions.length === 0) {
    return "TRUE";
  }
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJsonArraySql("onec_clients")}) outlet(elem)
    WHERE ${outletConditions.join(" AND ")}
  )`;
}

export function outletElemAlias(): string {
  return "outlet.elem";
}
