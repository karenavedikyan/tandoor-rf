import { combineScopeAndFilter } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import { getPool, query } from "../db/pool";
import { getCommittedSnapshotSha } from "../onec-exchange/state";
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

function resolveScopedFilter(context: AccessContext, input: ClientsListQuery): ReturnType<typeof buildClientsFilter> {
  const userFilter = buildClientsFilter(input);
  const scope = buildClientScopeSql(context);
  return combineScopeAndFilter(scope, userFilter);
}

export async function listClients(
  context: AccessContext,
  input: ClientsListQuery,
): Promise<ClientsListResponse> {
  const filter = resolveScopedFilter(context, input);
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

export async function getClientOptions(context: AccessContext): Promise<ClientsOptionsResponse> {
  const scope = buildClientScopeSql(context);
  const managerFilter = combineScopeAndFilter(scope, { whereSql: "", params: [] });
  const holdingFilter = combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_holding IS NOT NULL",
    params: [],
  });

  const managers = await query<OptionRow>(
    `
      SELECT DISTINCT ON (guid_manager)
        guid_manager::text AS id,
        name_manager AS name
      FROM onec_clients
      ${managerFilter.whereSql}
      ORDER BY guid_manager ASC, name_manager ASC
    `,
    managerFilter.params,
  );
  const holdings = await query<OptionRow>(
    `
      SELECT DISTINCT ON (guid_holding)
        guid_holding::text AS id,
        name_holding AS name
      FROM onec_clients
      ${holdingFilter.whereSql}
      ORDER BY guid_holding ASC, name_holding ASC
    `,
    holdingFilter.params,
  );

  return {
    managers: managers.rows.map((row) => toClientOption(row.id, row.name)),
    holdings: holdings.rows.map((row) => toClientOption(row.id, row.name)),
  };
}

export async function getClientByGuid(
  context: AccessContext,
  guid: string,
): Promise<ClientDetailDto | null> {
  const scope = buildClientScopeSql(context);
  const detailFilter = combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_client = $1::uuid",
    params: [guid],
  });
  if (detailFilter.whereSql === "WHERE FALSE") {
    return null;
  }

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
      ${detailFilter.whereSql}
    `,
    detailFilter.params,
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return toClientDetail(row);
}

export async function canReadClientGuid(
  context: AccessContext,
  guid: string,
): Promise<boolean> {
  const client = await getClientByGuid(context, guid);
  return client !== null;
}

type ExchangeStateQueryRow = {
  last_attempt_at: Date | null;
  last_verified_at: Date | null;
  last_verified_sha256: string | null;
  last_successful_apply_at: Date | null;
  last_successful_apply_sha256: string | null;
  last_source_modified_at: Date | null;
  apply_blocked: boolean;
};

export async function getClientsSyncStatus(options: {
  staleAfterHours?: number;
  includeAdminDetail?: boolean;
} = {}): Promise<ClientsSyncStatusResponse> {
  const staleAfterHours = options.staleAfterHours ?? 72;
  const lastSuccess = await query<{ finished_at: Date | null; source_record_count: number | null }>(
    `
      SELECT finished_at, source_record_count
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
  const latest = await query<{
    status: string;
    finished_at: Date | null;
    error_code: string | null;
    warning_count: number | null;
    warnings_truncated: boolean | null;
  }>(
    `
      SELECT status, finished_at, error_code, warning_count, warnings_truncated
      FROM onec_client_import_runs
      ORDER BY started_at DESC
      LIMIT 1
    `,
  );
  const exchangeState = await query<ExchangeStateQueryRow>(
    `
      SELECT
        last_attempt_at,
        last_verified_at,
        last_verified_sha256,
        last_successful_apply_at,
        last_successful_apply_sha256,
        last_source_modified_at,
        apply_blocked
      FROM onec_exchange_state
      WHERE id = 1
    `,
  );

  const state = exchangeState.rows[0];
  const lastSuccessfulImportAt =
    state?.last_successful_apply_at ?? lastSuccess.rows[0]?.finished_at ?? null;
  const lastAttemptAt = state?.last_attempt_at ?? null;
  const lastVerifiedAt = state?.last_verified_at ?? null;
  const lastVerifiedSha256 = state?.last_verified_sha256 ?? null;
  const sourceFormationKnown = state?.last_source_modified_at != null;

  let committedSha256 = state?.last_successful_apply_sha256 ?? null;
  if (!committedSha256) {
    const activePool = getPool();
    if (activePool) {
      const client = await activePool.connect();
      try {
        committedSha256 = await getCommittedSnapshotSha(client);
      } finally {
        client.release();
      }
    }
  }
  const runningImport = Number(running.rows[0]?.count ?? "0") > 0;
  const latestRun = latest.rows[0];

  let warning: string | null = null;
  let freshnessState: ClientsSyncStatusResponse["freshnessState"] = "unknown";

  if (runningImport) {
    freshnessState = "updating";
  } else if (!lastSuccessfulImportAt) {
    freshnessState = "never";
  } else if (
    latestRun &&
    (latestRun.status === "failed" || latestRun.status === "validation_failed") &&
    latestRun.finished_at &&
    (!lastSuccessfulImportAt || latestRun.finished_at > lastSuccessfulImportAt)
  ) {
    freshnessState = "error";
    warning =
      "Последняя попытка обновления завершилась с ошибкой; в ЛК остаются данные предыдущей успешной загрузки.";
  } else if (
    lastVerifiedSha256 &&
    committedSha256 &&
    lastVerifiedSha256 !== committedSha256
  ) {
    freshnessState = "pending_apply";
    warning =
      "На FTP обнаружен новый файл, но он ещё не применён в ЛК; отображаются данные последней успешной загрузки.";
  } else {
    const staleMs = staleAfterHours * 60 * 60 * 1000;
    freshnessState =
      lastSuccessfulImportAt &&
      Date.now() - lastSuccessfulImportAt.getTime() > staleMs
        ? "stale"
        : "current";
  }

  const response: ClientsSyncStatusResponse = {
    freshnessState,
    lastSuccessfulImportAt: lastSuccessfulImportAt?.toISOString() ?? null,
    lastSuccessfulImportAtLabel: lastSuccessfulImportAt
      ? formatMskDateTime(lastSuccessfulImportAt)
      : null,
    lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
    lastAttemptAtLabel: lastAttemptAt ? formatMskDateTime(lastAttemptAt) : null,
    lastVerifiedAt: lastVerifiedAt?.toISOString() ?? null,
    lastVerifiedAtLabel: lastVerifiedAt ? formatMskDateTime(lastVerifiedAt) : null,
    sourceFormationKnown,
    lastSourceModifiedAt: state?.last_source_modified_at?.toISOString() ?? null,
    lastSourceModifiedAtLabel: state?.last_source_modified_at
      ? formatMskDateTime(state.last_source_modified_at)
      : null,
    runningImport,
    warning,
  };

  if (options.includeAdminDetail) {
    response.adminDetail = {
      lastErrorCode: latestRun?.error_code ?? null,
      recordCount: lastSuccess.rows[0]?.source_record_count ?? null,
      committedSha256,
      verifiedSha256: lastVerifiedSha256,
      warningCount: latestRun?.warning_count ?? null,
      warningsTruncated: latestRun?.warnings_truncated ?? null,
      applyBlocked: state?.apply_blocked ?? false,
    };
  }

  return response;
}
