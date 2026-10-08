import { mergeSqlFilters } from "../access/combine-filters";
import { escapeIlikePattern } from "./phone";
import type { ClientsListQuery, SqlFilter } from "./query";

const CC = "onec_clients.extended_snapshot->'clientCode'";

export function applyClientCodeFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;

  if (query.onecCode1c) {
    filter = mergeSqlFilters(
      filter,
      [
        `(${CC}->'fieldPresence'->>'code1c') = 'true'
         AND ${CC}->>'code1c' = $1`,
      ],
      [query.onecCode1c],
    );
  }

  if (query.onecCode1cContains) {
    const pattern = `%${escapeIlikePattern(query.onecCode1cContains)}%`;
    filter = mergeSqlFilters(
      filter,
      [
        `(${CC}->'fieldPresence'->>'code1c') = 'true'
         AND NULLIF(${CC}->>'code1c', '') ILIKE $1 ESCAPE '\\'`,
      ],
      [pattern],
    );
  }

  return filter;
}
