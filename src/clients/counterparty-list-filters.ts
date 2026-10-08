import { mergeSqlFilters } from "../access/combine-filters";
import { escapeIlikePattern } from "./phone";
import type { ClientsListQuery, SqlFilter } from "./query";

const CP = "onec_clients.extended_snapshot->'counterparty'";

export function applyClientCounterpartyFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;

  if (query.onecCounterpartyContains) {
    const pattern = `%${escapeIlikePattern(query.onecCounterpartyContains)}%`;
    filter = mergeSqlFilters(
      filter,
      [
        `(${CP}->'fieldPresence'->>'counterparty') = 'true'
         AND NULLIF(${CP}->>'counterparty', '') ILIKE $1 ESCAPE '\\'`,
      ],
      [pattern],
    );
  }

  if (query.onecFullNameContains) {
    const pattern = `%${escapeIlikePattern(query.onecFullNameContains)}%`;
    filter = mergeSqlFilters(
      filter,
      [
        `(${CP}->'fieldPresence'->>'fullName') = 'true'
         AND NULLIF(${CP}->>'fullName', '') ILIKE $1 ESCAPE '\\'`,
      ],
      [pattern],
    );
  }

  if (query.onecLegalEntityType) {
    filter = mergeSqlFilters(
      filter,
      [
        `(${CP}->'fieldPresence'->>'legalEntityType') = 'true'
         AND ${CP}->>'legalEntityType' = $1`,
      ],
      [query.onecLegalEntityType],
    );
  }

  if (query.onecOgrn) {
    filter = mergeSqlFilters(
      filter,
      [
        `(${CP}->'fieldPresence'->>'ogrn') = 'true'
         AND ${CP}->>'ogrn' = $1`,
      ],
      [query.onecOgrn],
    );
  }

  return filter;
}
