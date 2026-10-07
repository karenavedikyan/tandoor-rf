import { mergeSqlFilters } from "../access/combine-filters";
import { escapeIlikePattern } from "./phone";
import type { ClientsListQuery, SqlFilter } from "./query";

const COMMERCIAL = "onec_clients.extended_snapshot->'commercial'";

export function applyClientCommercialFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;

  if (query.discountProgram) {
    filter = mergeSqlFilters(
      filter,
      [
        `NULLIF(BTRIM(${COMMERCIAL}->>'discountProgram'), '') ILIKE $1 ESCAPE '\\'`,
      ],
      [`%${escapeIlikePattern(query.discountProgram)}%`],
    );
  }

  if (query.discountAmountMin !== undefined) {
    filter = mergeSqlFilters(
      filter,
      [`(${COMMERCIAL}->>'discountAmount')::numeric >= $1`],
      [query.discountAmountMin],
    );
  }
  if (query.discountAmountMax !== undefined) {
    filter = mergeSqlFilters(
      filter,
      [`(${COMMERCIAL}->>'discountAmount')::numeric <= $1`],
      [query.discountAmountMax],
    );
  }

  if (query.markupName || query.markupPercentage !== undefined) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.markupName) {
      params.push(`%${escapeIlikePattern(query.markupName)}%`);
      conditions.push(`NULLIF(BTRIM(markup.elem->>'name'), '') ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (query.markupPercentage !== undefined) {
      params.push(query.markupPercentage);
      conditions.push(`(markup.elem->>'percentage')::numeric = $${params.length}`);
    }
    filter = mergeSqlFilters(
      filter,
      [
        `EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${COMMERCIAL}->'markups') AS markup(elem)
          WHERE ${conditions.join(" AND ")}
        )`,
      ],
      params,
    );
  }

  return filter;
}
