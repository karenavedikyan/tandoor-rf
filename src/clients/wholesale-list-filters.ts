import { mergeSqlFilters } from "../access/combine-filters";
import type { ClientsListQuery, SqlFilter } from "./query";

const WHOLESALE = "onec_clients.extended_snapshot->'wholesaleExchange'";

export function applyClientWholesaleExchangeFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;

  if (query.onecTop150) {
    filter = mergeSqlFilters(
      filter,
      [
        `(${WHOLESALE}->'fieldPresence'->>'top150') = 'true'
         AND ${WHOLESALE}->>'top150' = $1`,
      ],
      [query.onecTop150],
    );
  }

  if (query.onecCategory) {
    filter = mergeSqlFilters(
      filter,
      [
        `(${WHOLESALE}->'fieldPresence'->>'outletCategory') = 'true'
         AND ${WHOLESALE}->>'outletCategory' = $1`,
      ],
      [query.onecCategory],
    );
  }

  return filter;
}
