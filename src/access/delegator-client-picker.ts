import { combineScopeAndFilter } from "./combine-filters";
import { buildClientScopeSql } from "./scope-sql";
import type { AccessContext } from "./types";
import { query } from "../db/pool";
import { buildClientsFilter, type ClientsListQuery } from "../clients/query";

export type DelegatorClientPickItemDto = {
  guid: string;
  name: string;
};

export type DelegatorClientPickerResponse = {
  items: DelegatorClientPickItemDto[];
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
};

type CountRow = { count: string };
type PickRow = { guid_client: string; name_client: string };

export async function listDelegatorClientsPicker(
  delegatorContext: AccessContext,
  input: ClientsListQuery,
): Promise<DelegatorClientPickerResponse> {
  const userFilter = buildClientsFilter(input);
  const scope = buildClientScopeSql(delegatorContext);
  const filter = combineScopeAndFilter(scope, userFilter);

  const totalResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count FROM onec_clients ${filter.whereSql}`,
    filter.params,
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.pageSize);
  const offset = (input.page - 1) * input.pageSize;

  const listParams = [...filter.params, input.pageSize, offset];
  const limitParam = `$${filter.params.length + 1}`;
  const offsetParam = `$${filter.params.length + 2}`;

  const rows = await query<PickRow>(
    `
      SELECT guid_client::text, name_client
      FROM onec_clients
      ${filter.whereSql}
      ORDER BY name_client ASC, guid_client ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    listParams,
  );

  return {
    items: rows.rows.map((row) => ({
      guid: row.guid_client,
      name: row.name_client,
    })),
    page: input.page,
    pageSize: input.pageSize,
    totalPages,
    total,
  };
}
