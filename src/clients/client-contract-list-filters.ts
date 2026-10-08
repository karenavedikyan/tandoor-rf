import { mergeSqlFilters } from "../access/combine-filters";
import { escapeIlikePattern } from "./phone";
import type { ClientsListQuery, SqlFilter } from "./query";

const CC = "onec_clients.extended_snapshot->'clientContract'";

export function applyClientContractFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;

  if (query.onecPrimaryContractContains) {
    const pattern = `%${escapeIlikePattern(query.onecPrimaryContractContains)}%`;
    filter = mergeSqlFilters(
      filter,
      [
        `(${CC}->'fieldPresence'->>'primaryContract') = 'true'
         AND NULLIF(${CC}->>'primaryContract', '') ILIKE $1 ESCAPE '\\'`,
      ],
      [pattern],
    );
  }

  if (query.onecMainAgreementContains) {
    const pattern = `%${escapeIlikePattern(query.onecMainAgreementContains)}%`;
    filter = mergeSqlFilters(
      filter,
      [
        `(${CC}->'fieldPresence'->>'mainAgreement') = 'true'
         AND NULLIF(${CC}->>'mainAgreement', '') ILIKE $1 ESCAPE '\\'`,
      ],
      [pattern],
    );
  }

  return filter;
}
