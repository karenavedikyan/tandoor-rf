import { query } from "../db/pool";
import type { ClientsListQuery } from "./query";
import { buildClientsFilter } from "./query";
import {
  toClientDetail,
  toClientListItem,
  toClientOption,
  type ClientDetailDto,
  type ClientsListResponse,
  type ClientsOptionsResponse,
  type ClientsSyncStatusResponse,
  formatMskDateTime,
} from "./dto";

type ClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: unknown;
  last_imported_at: Date;
};

type CountRow = { count: string };
type OptionRow = { id: string; name: string };

export async function countAllClients(): Promise<number> {
  const result = await query<CountRow>("SELECT COUNT(*)::text AS count FROM onec_clients");
  return Number(result.rows[0]?.count ?? "0");
}

export async function listClients(input: ClientsListQuery): Promise<ClientsListResponse> {
  const filter = buildClientsFilter(input);
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

  const rows = await query<ClientRow>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        address,
        telephone,
        last_imported_at
      FROM onec_clients
      ${filter.whereSql}
      ORDER BY name_client ASC, guid_client ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    listParams,
  );

  return {
    items: rows.rows.map(toClientListItem),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages,
    isEmptyDatabase: false,
  };
}

export async function getClientOptions(): Promise<ClientsOptionsResponse> {
  const managers = await query<OptionRow>(
    `
      SELECT guid_manager::text AS id, name_manager AS name
      FROM onec_clients
      GROUP BY guid_manager, name_manager
      ORDER BY name_manager ASC, guid_manager ASC
    `,
  );
  const holdings = await query<OptionRow>(
    `
      SELECT guid_holding::text AS id, name_holding AS name
      FROM onec_clients
      WHERE guid_holding IS NOT NULL
      GROUP BY guid_holding, name_holding
      ORDER BY name_holding ASC, guid_holding ASC
    `,
  );

  return {
    managers: managers.rows.map((row) => toClientOption(row.id, row.name)),
    holdings: holdings.rows.map((row) => toClientOption(row.id, row.name)),
  };
}

export async function getClientByGuid(guid: string): Promise<ClientDetailDto | null> {
  const result = await query<ClientRow>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        address,
        telephone,
        last_imported_at
      FROM onec_clients
      WHERE guid_client = $1::uuid
    `,
    [guid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return toClientDetail(row);
}

export async function getClientsSyncStatus(): Promise<ClientsSyncStatusResponse> {
  const lastSuccess = await query<{ finished_at: Date | null }>(
    `
      SELECT finished_at
      FROM onec_client_import_runs
      WHERE status = 'success' AND mode = 'apply'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  const running = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
    `,
  );
  const latest = await query<{ status: string; finished_at: Date | null; error_code: string | null }>(
    `
      SELECT status, finished_at, error_code
      FROM onec_client_import_runs
      ORDER BY started_at DESC
      LIMIT 1
    `,
  );

  const lastSuccessfulImportAt = lastSuccess.rows[0]?.finished_at ?? null;
  const runningImport = Number(running.rows[0]?.count ?? "0") > 0;
  const latestRun = latest.rows[0];

  let warning: string | null = null;
  if (
    lastSuccessfulImportAt &&
    latestRun &&
    latestRun.status === "failed" &&
    latestRun.finished_at &&
    latestRun.finished_at > lastSuccessfulImportAt
  ) {
    warning =
      "Последний импорт завершился с ошибкой; в базе остаются данные предыдущей успешной загрузки.";
  }

  return {
    lastSuccessfulImportAt: lastSuccessfulImportAt?.toISOString() ?? null,
    lastSuccessfulImportAtLabel: lastSuccessfulImportAt
      ? formatMskDateTime(lastSuccessfulImportAt)
      : null,
    runningImport,
    warning,
  };
}
