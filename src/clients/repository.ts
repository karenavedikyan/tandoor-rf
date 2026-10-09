import { appendSqlClauses, combineScopeAndFilter, mergeSqlFilters } from "../access/combine-filters";
import { loadRopTeamEmployeeGuids } from "../access/rop-read-scope";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import { getPool, query } from "../db/pool";
import { getCommittedSnapshotSha } from "../onec-exchange/state";
import { buildReviewStateFilter } from "./review/repository";
import {
  applyOrgTeamsClientFilter,
} from "./org/teams-list-filters";
import { resolveOnecPortfolioTargetGuids } from "./org/onec-portfolio-query";
import {
  assertOnecTeamPortfolioAccess,
  buildOnecTeamClientsFilter,
  onecTeamManagerAccessFilter,
  OnecTeamPortfolioAccessError,
} from "./org/onec-team-portfolio";
import { buildCompletenessReasonsFilter } from "./org/completeness-repository";
import {
  applyClientEntityScopedOutletFilter,
  applyClientLevelFilledEmptyFilters,
} from "./client-entity-outlet-filter";
import { applyClientCommercialFilters } from "./commercial-list-filters";
import { applyClientCodeFilters } from "./client-code-list-filters";
import { applyClientContractFilters } from "./client-contract-list-filters";
import { applyClientCounterpartyFilters } from "./counterparty-list-filters";
import { applyClientWholesaleExchangeFilters } from "./wholesale-list-filters";
import { hasOutletDerivedClientFilters } from "./field-filter-registry";
import { buildOptionsDualScopeCte, scopedOutletLateralJoinSql } from "./outlet-elem-access";
import { applyClientListAssignmentFilters } from "./list-assignment-filters";
import {
  clientHeadOfSalesGuidSql,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
} from "./org/assignment-sql";
import {
  assertManagerInTeamScope,
  buildTeamRopFilter,
  employeePortfolioClause,
  TeamAccessError,
} from "./teams/repository";
import { buildUnassignedCategoryFilter, buildUnassignedSummary } from "./unassigned/repository";
import type { ClientsListQuery } from "./query";
import { buildClientsFilter } from "./query";
import { outletsJsonArraySql, scopedHasOutletsClause, scopedOutletsCountSql } from "./outlets/scope-sql";
import { buildClientsOrderBy } from "./sort";
import {
  canUseCompletenessNavigation,
  canUseReviewNavigation,
  canUseUnassignedNavigation,
} from "./role-presentation";
import {
  loadHoldingV2ClientExchange,
  loadHoldingV2ListSummaries,
  loadHoldingV2OutletExchange,
} from "./holding-v2-exchange";
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
  guid_holding_pending?: string | null;
  holding_link_state?: import("../onec-clients/holding-link-policy").HoldingLinkState;
  manager_roster_state?: import("../onec-clients/extended-types").ClientManagerRosterState;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: unknown;
  last_imported_at: Date;
  source_sha256: string | null;
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
  extended_freshness_state: import("../onec-clients/extended-types").ExtendedFreshnessState | null;
  extended_snapshot: unknown;
};

type CountRow = { count: string };
type OptionRow = { id: string; name: string };

export async function countAllClients(): Promise<number> {
  const result = await query<CountRow>(
    `SELECT COUNT(*)::text AS count FROM onec_clients WHERE COALESCE(baseline_status, 'active') = 'active'`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function resolveScopedFilter(
  context: AccessContext,
  input: ClientsListQuery,
): Promise<{
  whereSql: string;
  params: unknown[];
  selectExtraParams: unknown[];
  joinSql: string;
  extraSelect: string;
  outletsCountExpr: string;
}> {
  if (input.view === "review" && !canUseReviewNavigation(context)) {
    throw new ListClientsError("Очередь ревизии недоступна для вашей роли.", "FORBIDDEN");
  }

  if (input.view === "completeness" && !canUseCompletenessNavigation(context)) {
    throw new ListClientsError("Очередь незаполненных назначений недоступна для вашей роли.", "FORBIDDEN");
  }

  const hasReviewFilter =
    (input.reviewState && input.reviewState !== "any") ||
    (input.reviewDecision && input.reviewDecision !== "any");
  if (hasReviewFilter && !canUseReviewNavigation(context)) {
    throw new ListClientsError("Фильтры ревизии недоступны для вашей роли.", "FORBIDDEN");
  }

  if (input.unassignedCategory && !canUseUnassignedNavigation(context)) {
    throw new ListClientsError(
      "Фильтр нераспределённых назначений недоступен для вашей роли.",
      "FORBIDDEN",
    );
  }

  const ropEmployeeGuid =
    input.ropEmployeeGuid ??
    (input.view === "teams" &&
    context.role === "rop" &&
    context.employeeId &&
    !input.ropUserId
      ? context.employeeId.toLowerCase()
      : undefined);

  if (input.ropUserId && input.managerId) {
    try {
      await assertManagerInTeamScope(context, input.ropUserId, input.managerId);
    } catch (error) {
      if (error instanceof TeamAccessError) {
        throw new ListClientsError(error.message, error.code);
      }
      throw error;
    }
  } else if (
    ropEmployeeGuid &&
    input.view === "teams" &&
    (input.managerId || input.regionalManagerId || input.hardwareManagerId || input.branchPortfolio)
  ) {
    if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
      throw new ListClientsError("Нет доступа к ветке РОП.", "FORBIDDEN");
    }
  } else if (input.ropUserId && input.view === "teams") {
    if (context.role !== "admin" && context.role !== "rop" && !context.fullClientBase) {
      throw new ListClientsError("Нет доступа к команде.", "FORBIDDEN");
    }
    if (context.role === "rop" && context.userId !== input.ropUserId) {
      throw new ListClientsError("Нет доступа к команде.", "FORBIDDEN");
    }
  } else if (ropEmployeeGuid && input.view === "teams") {
    if (context.role !== "admin" && context.role !== "rop" && !context.fullClientBase) {
      throw new ListClientsError("Нет доступа к структуре по назначениям.", "FORBIDDEN");
    }
    if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
      throw new ListClientsError("Нет доступа к ветке РОП.", "FORBIDDEN");
    }
  }

  const onecEmployeePortfolio =
    input.view === "teams" &&
    input.teamSource === "onec" &&
    Boolean(input.onecPortfolioEmployeeGuid);
  const portfolioManagerId =
    !onecEmployeePortfolio &&
    input.view === "teams" &&
    input.managerId &&
    !ropEmployeeGuid
      ? input.managerId
      : undefined;
  let userFilter = buildClientsFilter(
    portfolioManagerId ? { ...input, managerId: undefined } : input,
  );
  const scope = buildClientScopeSql(context, {
    ropDirectClientList: context.role === "rop" && input.entity === "clients",
    managerDirectClientList: context.role === "manager" && input.entity === "clients",
  });

  if (portfolioManagerId) {
    userFilter = combineScopeAndFilter(userFilter, {
      whereSql: `WHERE ${employeePortfolioClause("$1::uuid")}`,
      params: [portfolioManagerId],
    });
  }

  if (
    input.view === "teams" &&
    input.teamSource === "onec" &&
    input.onecTeamGuid &&
    input.branchPortfolio === "clients" &&
    input.entity === "clients"
  ) {
    try {
      const memberGuids = await assertOnecTeamPortfolioAccess(context, input.onecTeamGuid);
      const targetGuids = resolveOnecPortfolioTargetGuids(input, memberGuids);
      if (input.onecPortfolioEmployeeGuid && targetGuids.length === 0) {
        userFilter = combineScopeAndFilter(userFilter, { whereSql: "WHERE FALSE", params: [] });
      } else {
        const portfolioGuids = targetGuids.length > 0 ? targetGuids : memberGuids;
        const managerDenied =
          !input.onecPortfolioEmployeeGuid &&
          onecTeamManagerAccessFilter(memberGuids, portfolioManagerId);
        if (managerDenied) {
          userFilter = combineScopeAndFilter(userFilter, managerDenied);
        } else {
          userFilter = combineScopeAndFilter(userFilter, buildOnecTeamClientsFilter(portfolioGuids));
        }
      }
    } catch (error) {
      if (error instanceof OnecTeamPortfolioAccessError) {
        throw new ListClientsError(error.message, error.code);
      }
      throw error;
    }
  } else if (
    input.view === "teams" &&
    input.teamSource === "onec" &&
    input.onecTeamGuid &&
    input.branchPortfolio === "outlets" &&
    input.entity === "clients"
  ) {
    userFilter = { whereSql: "WHERE FALSE", params: [] };
  }

  if (input.unassignedCategory) {
    const summary = await buildUnassignedSummary({ category: input.unassignedCategory });
    const employeeGuids = summary.employees.map((e) => e.employeeGuid);
    userFilter = combineScopeAndFilter(
      userFilter,
      buildUnassignedCategoryFilter(input.unassignedCategory, employeeGuids),
    );
  }

  if (input.view === "teams" && ropEmployeeGuid && input.teamSource !== "onec") {
    userFilter = applyOrgTeamsClientFilter(userFilter, input, ropEmployeeGuid);
  } else if (input.view === "teams" && input.ropUserId && !input.managerId) {
    userFilter = combineScopeAndFilter(userFilter, await buildTeamRopFilter(input.ropUserId));
  }

  if (input.completenessReasons && input.completenessReasons.length > 0) {
    userFilter = combineScopeAndFilter(
      userFilter,
      buildCompletenessReasonsFilter(
        input.completenessReasons,
        input.completenessReasonMode ?? "any",
      ),
    );
  }

  userFilter = applyClientListAssignmentFilters(userFilter, input);
  if (input.entity === "clients") {
    if (hasOutletDerivedClientFilters(input)) {
      userFilter = applyClientEntityScopedOutletFilter(userFilter, input, context);
    }
    userFilter = applyClientLevelFilledEmptyFilters(userFilter, input);
    userFilter = applyClientCommercialFilters(userFilter, input);
    userFilter = applyClientWholesaleExchangeFilters(userFilter, input);
    userFilter = applyClientCounterpartyFilters(userFilter, input);
    userFilter = applyClientContractFilters(userFilter, input);
    userFilter = applyClientCodeFilters(userFilter, input);
  }


  const reviewJoin = buildReviewStateFilter(
    input.reviewState ?? (input.view === "review" ? "any" : "any"),
    input.reviewDecision,
  );
  if (reviewJoin.whereClauses.length > 0) {
    userFilter = mergeSqlFilters(userFilter, reviewJoin.whereClauses, reviewJoin.params);
  }

  let combined = combineScopeAndFilter(scope, userFilter);

  let scopedEmployeeParam: string | undefined;
  let selectExtraParams: unknown[] = [];
  if (
    (context.role === "regional_manager" || context.role === "manager") &&
    context.employeeId
  ) {
    const existingEmployeeIndex = combined.params.findIndex(
      (param) => typeof param === "string" && param.toLowerCase() === context.employeeId!.toLowerCase(),
    );
    if (existingEmployeeIndex >= 0) {
      scopedEmployeeParam = `$${existingEmployeeIndex + 1}${context.role === "regional_manager" ? "::text" : ""}`;
    } else {
      scopedEmployeeParam = `$${combined.params.length + 1}${context.role === "regional_manager" ? "::text" : ""}`;
      if (input.hasOutlets === "yes" || input.hasOutlets === "no") {
        combined = {
          whereSql: combined.whereSql,
          params: [...combined.params, context.employeeId],
        };
      } else {
        selectExtraParams = [context.employeeId];
      }
    }
  }
  const outletsCountExpr =
    combined.whereSql === "WHERE FALSE"
      ? "0"
      : scopedOutletsCountSql(context, "onec_clients", scopedEmployeeParam);

  if (input.hasOutlets === "yes" || input.hasOutlets === "no") {
    if (combined.whereSql !== "WHERE FALSE") {
      combined = appendSqlClauses(combined, [
        scopedHasOutletsClause(context, input.hasOutlets, "onec_clients", scopedEmployeeParam),
      ]);
    }
  }

  const includeReview =
    canUseReviewNavigation(context) &&
    (input.view === "review" || input.reviewState || input.reviewDecision);
  const includeTeamContext = input.view === "teams" || input.view === "review" || Boolean(input.unassignedCategory);

  const joinSql = [
    includeReview ? reviewJoin.joinSql : "",
    includeTeamContext
      ? `
        LEFT JOIN LATERAL (
          SELECT u.full_name AS rop_name
          FROM rop_team_members rtm
          JOIN user_onec_employee_links uoel
            ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
          JOIN users u ON u.id = rtm.rop_user_id
          WHERE rtm.revoked_at IS NULL
            AND uoel.employee_id = onec_clients.guid_manager
          ORDER BY rtm.created_at ASC
          LIMIT 1
        ) team_ctx ON TRUE
      `
      : "",
  ].join("\n");

  const extraSelect = [
    includeReview
      ? `
        , crr.review_state
        , crr.review_decision
        , crr.stale_reason AS review_stale_reason
        , crr.basis_manager_guid::text AS review_basis_manager_guid
        , crr.basis_data_fingerprint AS review_basis_data_fingerprint
        , crr.proposed_manager_guid::text AS review_proposed_manager_guid
        , onec_clients.guid_holding_pending::text
        , onec_clients.holding_link_state
      `
      : "",
    includeTeamContext
      ? `
        , team_ctx.rop_name AS team_label
        , CASE
            WHEN COALESCE(onec_clients.manager_roster_state, 'in_wholesale_roster') = 'outside_wholesale_roster'
              THEN 'Вне списка ОПТ'
            WHEN COALESCE(onec_clients.manager_roster_state, 'in_wholesale_roster') = 'roster_not_loaded'
              THEN 'Roster не загружен'
            WHEN team_ctx.rop_name IS NULL
              THEN 'Без команды РОП'
            ELSE NULL
          END AS unassigned_reason
      `
      : "",
    `
        , ${outletsCountExpr}::text AS outlets_count
        `,
  ].join("\n");

  return {
    whereSql: combined.whereSql,
    params: combined.params,
    selectExtraParams,
    joinSql,
    extraSelect,
    outletsCountExpr,
  };
}

export class ListClientsError extends Error {
  code: "FORBIDDEN" | "NOT_FOUND";

  constructor(message: string, code: "FORBIDDEN" | "NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

export async function listClients(
  context: AccessContext,
  input: ClientsListQuery,
): Promise<ClientsListResponse> {
  const filter = await resolveScopedFilter(context, input);
  const fromSql = `FROM onec_clients ${filter.joinSql}`;
  const totalResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count ${fromSql} ${filter.whereSql}`,
    filter.params,
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.pageSize);
  const offset = (input.page - 1) * input.pageSize;

  const listParams = [...filter.params, ...filter.selectExtraParams, input.pageSize, offset];
  const paginationBase = filter.params.length + filter.selectExtraParams.length;
  const limitParam = `$${paginationBase + 1}`;
  const offsetParam = `$${paginationBase + 2}`;

  const includeTeamContext =
    input.view === "teams" || input.view === "review" || Boolean(input.unassignedCategory);
  const orderBy = buildClientsOrderBy(input, {
    includeTeamSort: includeTeamContext,
    outletsCountExpr: filter.outletsCountExpr,
  });

  const rows = await query<ClientRow>(
    `
      SELECT
        onec_clients.guid_client::text,
        onec_clients.name_client,
        onec_clients.guid_holding::text,
        onec_clients.name_holding,
        onec_clients.guid_manager::text,
        onec_clients.name_manager,
        onec_clients.address,
        onec_clients.telephone,
        onec_clients.last_imported_at,
        onec_clients.extended_snapshot->'regionalManager' AS ext_regional_manager,
        onec_clients.extended_snapshot->'hardwareManager' AS ext_hardware_manager,
        onec_clients.extended_snapshot->'headOfSales' AS ext_head_of_sales,
        onec_clients.extended_snapshot->'commercial' AS ext_commercial,
        onec_clients.extended_snapshot->'wholesaleExchange' AS ext_wholesale_exchange,
        onec_clients.extended_snapshot->'counterparty' AS ext_counterparty,
        onec_clients.extended_snapshot->'clientContract' AS ext_client_contract,
        onec_clients.extended_snapshot->'clientCode' AS ext_client_code
        ${filter.extraSelect}
      ${fromSql}
      ${filter.whereSql}
      ${orderBy}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    listParams,
  );

  const items = rows.rows.map(toClientListItem);
  const pool = getPool();
  if (pool) {
  const summaries = await loadHoldingV2ListSummaries(
    pool,
    context,
    items.map((item) => item.guid),
  );
  for (const item of items) {
    const summary = summaries.get(item.guid.toLowerCase());
    if (!summary) {
      continue;
    }
    item.holdingV2CompositionLabel = summary.compositionLabel;
    if (summary.nameTypeLabel) {
      item.holdingV2TypeCategoryLabel = summary.nameTypeLabel;
    }
    if (summary.nameCategoryLabel) {
      item.holdingV2NameCategoryLabel = summary.nameCategoryLabel;
    }
  }
  }

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages,
    isEmptyDatabase: false,
  };
}

export async function getClientOptions(context: AccessContext): Promise<ClientsOptionsResponse> {
  const directScope = buildClientScopeSql(context, {
    ropDirectClientList: context.role === "rop",
    managerDirectClientList: context.role === "manager",
  });
  const cardScope = buildClientScopeSql(context, {
    ropDirectClientList: false,
    managerDirectClientList: false,
  });
  const directFilter = combineScopeAndFilter(directScope, { whereSql: "", params: [] });
  const cardFilter = combineScopeAndFilter(cardScope, { whereSql: "", params: [] });
  const holdingFilter = combineScopeAndFilter(directScope, {
    whereSql: "WHERE guid_holding IS NOT NULL",
    params: [],
  });

  const managers = await query<OptionRow>(
    `
      SELECT DISTINCT ON (guid_manager)
        guid_manager::text AS id,
        name_manager AS name
      FROM onec_clients
      ${directFilter.whereSql}
      ORDER BY guid_manager ASC, name_manager ASC
    `,
    directFilter.params,
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

  const dualScopeCte = buildOptionsDualScopeCte(directFilter.whereSql, cardFilter.whereSql);
  const outletJoin = scopedOutletLateralJoinSql(context, "scoped_card_clients", cardFilter.params);
  const optionsParams = [...cardFilter.params, ...outletJoin.extraParams];

  const outletManagers = await query<OptionRow>(
    `
      ${cardFilter.whereSql ? `WITH scoped_card_clients AS (SELECT * FROM onec_clients ${cardFilter.whereSql})` : "WITH scoped_card_clients AS (SELECT * FROM onec_clients)"}
      SELECT DISTINCT ON (manager_guid)
        manager_guid AS id,
        COALESCE(manager_name, manager_guid) AS name
      FROM (
        SELECT
          ${outletManagerGuidSql(outletJoin.outletAlias)} AS manager_guid,
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'manager'->>'name'), '') AS manager_name
        FROM scoped_card_clients
        ${outletJoin.lateralSql}
        WHERE ${outletJoin.whereSql}
      ) scoped_outlet_managers
      WHERE manager_guid IS NOT NULL
      ORDER BY manager_guid ASC, manager_name ASC
    `,
    optionsParams,
  );

  const regionalManagers = await query<OptionRow>(
    `
      ${dualScopeCte}
      SELECT DISTINCT ON (regional_guid)
        regional_guid AS id,
        COALESCE(regional_name, regional_guid) AS name
      FROM (
        SELECT
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'regionalManager'->>'guid'), '') AS regional_guid,
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'regionalManager'->>'name'), '') AS regional_name
        FROM scoped_card_clients
        ${outletJoin.lateralSql}
        WHERE ${outletJoin.whereSql}
        UNION ALL
        SELECT
          NULLIF(BTRIM(extended_snapshot->'regionalManager'->>'guid'), '') AS regional_guid,
          NULLIF(BTRIM(extended_snapshot->'regionalManager'->>'name'), '') AS regional_name
        FROM scoped_clients
      ) scoped_regional
      WHERE regional_guid IS NOT NULL
      ORDER BY regional_guid ASC, regional_name ASC
    `,
    optionsParams,
  );

  const hardwareManagers = await query<OptionRow>(
    `
      ${dualScopeCte}
      SELECT DISTINCT ON (hardware_guid)
        hardware_guid AS id,
        COALESCE(hardware_name, hardware_guid) AS name
      FROM (
        SELECT
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'hardwareManager'->>'guid'), '') AS hardware_guid,
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'hardwareManager'->>'name'), '') AS hardware_name
        FROM scoped_card_clients
        ${outletJoin.lateralSql}
        WHERE ${outletJoin.whereSql}
        UNION ALL
        SELECT
          NULLIF(BTRIM(extended_snapshot->'hardwareManager'->>'guid'), '') AS hardware_guid,
          NULLIF(BTRIM(extended_snapshot->'hardwareManager'->>'name'), '') AS hardware_name
        FROM scoped_clients
      ) scoped_hardware
      WHERE hardware_guid IS NOT NULL
      ORDER BY hardware_guid ASC, hardware_name ASC
    `,
    optionsParams,
  );

  const rops = await query<OptionRow>(
    `
      ${dualScopeCte}
      SELECT DISTINCT ON (rop_guid)
        rop_guid AS id,
        COALESCE(rop_name, rop_guid) AS name
      FROM (
        SELECT
          ${clientHeadOfSalesGuidSql("scoped_clients")} AS rop_guid,
          NULLIF(BTRIM(scoped_clients.extended_snapshot->'headOfSales'->>'name'), '') AS rop_name
        FROM scoped_clients
        UNION ALL
        SELECT
          ${outletHeadOfSalesGuidSql(outletJoin.outletAlias)} AS rop_guid,
          NULLIF(BTRIM(${outletJoin.outletAlias}->'managers'->'headOfSales'->>'name'), '') AS rop_name
        FROM scoped_card_clients
        ${outletJoin.lateralSql}
        WHERE ${outletJoin.whereSql}
      ) scoped_rop
      WHERE rop_guid IS NOT NULL
      ORDER BY rop_guid ASC, rop_name ASC
    `,
    optionsParams,
  );

  const wholesaleBase = "extended_snapshot->'wholesaleExchange'";
  const wholesaleScopeSql = directFilter.whereSql
    ? `${directFilter.whereSql} AND`
    : "WHERE";
  const onecTop150Values = await query<{ value: string }>(
    `
      SELECT DISTINCT ${wholesaleBase}->>'top150' AS value
      FROM onec_clients
      ${wholesaleScopeSql}
        (${wholesaleBase}->'fieldPresence'->>'top150') = 'true'
        AND NULLIF(BTRIM(${wholesaleBase}->>'top150'), '') IS NOT NULL
      ORDER BY value ASC
    `,
    directFilter.params,
  );
  const onecCategoryValues = await query<{ value: string }>(
    `
      SELECT DISTINCT ${wholesaleBase}->>'outletCategory' AS value
      FROM onec_clients
      ${wholesaleScopeSql}
        (${wholesaleBase}->'fieldPresence'->>'outletCategory') = 'true'
        AND NULLIF(BTRIM(${wholesaleBase}->>'outletCategory'), '') IS NOT NULL
      ORDER BY value ASC
    `,
    directFilter.params,
  );

  const cpBase = "extended_snapshot->'counterparty'";
  const onecLegalEntityTypeValues = await query<{ value: string }>(
    `
      SELECT DISTINCT ${cpBase}->>'legalEntityType' AS value
      FROM onec_clients
      ${wholesaleScopeSql}
        (${cpBase}->'fieldPresence'->>'legalEntityType') = 'true'
        AND NULLIF(BTRIM(${cpBase}->>'legalEntityType'), '') IS NOT NULL
      ORDER BY value ASC
    `,
    directFilter.params,
  );

  return {
    managers: managers.rows.map((row) => toClientOption(row.id, row.name)),
    outletManagers: outletManagers.rows.map((row) => toClientOption(row.id, row.name)),
    holdings: holdings.rows.map((row) => toClientOption(row.id, row.name)),
    regionalManagers: regionalManagers.rows.map((row) => toClientOption(row.id, row.name)),
    hardwareManagers: hardwareManagers.rows.map((row) => toClientOption(row.id, row.name)),
    rops: rops.rows.map((row) => toClientOption(row.id, row.name)),
    onecTop150Values: onecTop150Values.rows.map((row) => toClientOption(row.value, row.value)),
    onecCategoryValues: onecCategoryValues.rows.map((row) => toClientOption(row.value, row.value)),
    onecLegalEntityTypeValues: onecLegalEntityTypeValues.rows.map((row) =>
      toClientOption(row.value, row.value),
    ),
  };
}

async function loadActiveLinkedEmployeeGuids(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL
    `,
  );
  return new Set(result.rows.map((row) => row.employee_id.toLowerCase()));
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

  const linkedEmployeeGuids = await loadActiveLinkedEmployeeGuids();
  const ropTeamEmployeeGuids =
    context.role === "rop" && context.employeeId
      ? await loadRopTeamEmployeeGuids(context.userId, context.employeeId)
      : undefined;

  const result = await query<ClientRow>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_holding_pending::text,
        holding_link_state,
        manager_roster_state,
        guid_manager::text,
        name_manager,
        address,
        telephone,
        last_imported_at,
        source_sha256,
        is_holding,
        extended_format_version,
        extended_source_sha256,
        extended_imported_at,
        extended_freshness_state,
        extended_snapshot
      FROM onec_clients
      ${detailFilter.whereSql}
    `,
    detailFilter.params,
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const detail = toClientDetail(row, context, { linkedEmployeeGuids, ropTeamEmployeeGuids });
  const pool = getPool();
  if (pool) {
    const holdingV2 = await loadHoldingV2ClientExchange(pool, guid, {
      context,
      typeCategoryVisibility: "visible",
    });
    if (holdingV2) {
      detail.holdingV2 = holdingV2;
    }
    if (detail.extended?.retailOutlets) {
      for (const outlet of detail.extended.retailOutlets) {
        if (!outlet.guidStore) {
          continue;
        }
        const outletV2 = await loadHoldingV2OutletExchange(pool, outlet.guidStore, {
          typeCategoryVisibility: "visible",
        });
        if (outletV2) {
          outlet.holdingV2 = outletV2;
        }
      }
    }
  }
  return detail;
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
