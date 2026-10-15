import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";
import { v3CategoryNameSql, v3JsonManagerField } from "./json-paths";
import {
  LEGAL_ADDRESS_SQL,
} from "./list-sql-expressions";
import {
  appendCatalogAssignmentFilters,
  appendTerritoryAssignmentFilters,
  appendV3ColumnFilters,
  type V3ListQuery,
} from "./list";
import { appendV3FieldRulesSql } from "./list-field-rules";

const MISSING_GROUP_FIELD = "Не передано из 1С";
const ZERO_HOLDING = "00000000-0000-0000-0000-000000000000";

export function v3LegalGroupKeyExpr(leAlias: string): string {
  return `(CASE
    WHEN COALESCE(${leAlias}.membership_conflict, false) = true THEN 'legal:' || ${leAlias}.guid_client::text
    WHEN ${leAlias}.guid_holding IS NULL OR ${leAlias}.guid_holding = '${ZERO_HOLDING}'::uuid THEN 'legal:' || ${leAlias}.guid_client::text
    WHEN NOT EXISTS (
      SELECT 1 FROM onec_v3_holdings _v3gh WHERE _v3gh.guid_holding = ${leAlias}.guid_holding
    ) THEN 'legal:' || ${leAlias}.guid_client::text
    ELSE 'holding:' || ${leAlias}.guid_holding::text
  END)`;
}

function renumberScopeClause(clause: string, startIndex: number): string {
  return clause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + startIndex - 1}`);
}

function appendGroupedSearch(
  qPattern: string,
  params: unknown[],
  holdingScopeClause: string,
  holdingScopeParams: unknown[],
): string {
  params.push(qPattern);
  const p = `$${params.length}`;
  const holdingStart = params.length + 1;
  params.push(...holdingScopeParams);
  const holdingClause = renumberScopeClause(holdingScopeClause, holdingStart);
  return ` AND (
    le.name_client ILIKE ${p} ESCAPE '\\' OR
    COALESCE(${LEGAL_ADDRESS_SQL}, '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameRegionalManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHeadOfSales', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.managers->>'nameHardwareManager', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.other_fields->>'Код', '') ILIKE ${p} ESCAPE '\\' OR
    COALESCE(le.name_holding, '') ILIKE ${p} ESCAPE '\\' OR
    EXISTS (
      SELECT 1 FROM onec_v3_holdings h_s
      WHERE h_s.guid_holding = le.guid_holding
        AND (${holdingClause})
        AND h_s.name_holding ILIKE ${p} ESCAPE '\\'
    )
  )`;
}

function distinctOrMissing(expression: string): string {
  return `CASE
    WHEN COUNT(DISTINCT ${expression}) FILTER (WHERE NULLIF(TRIM(COALESCE(${expression}, '')), '') IS NOT NULL) > 1
      THEN '${MISSING_GROUP_FIELD}'
    ELSE MAX(${expression})
  END`;
}

function appendEligibilityFilters(
  input: V3ListQuery,
  params: unknown[],
  holdingScope: ReturnType<typeof v3HoldingVisibilityScope>,
): string {
  let sql = appendCatalogAssignmentFilters(input, "le", params);
  sql += appendV3ColumnFilters(input, "legal", params);
  sql = appendV3FieldRulesSql(sql, params, "legal_grouped", "le", input.fieldRules).sql;
  const q = input.q.trim();
  const qPattern = q.length > 0 ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;
  if (qPattern) {
    sql += appendGroupedSearch(qPattern, params, holdingScope.clause, holdingScope.params);
  }
  return sql;
}

export async function countV3LegalGroups(
  context: AccessContext,
  territory: Pick<V3ListQuery, "ropBranchGuid" | "responsibleGuid" | "responsibleKind" | "managerGuid">,
): Promise<number> {
  const scope = v3EntityAssignmentScope(context, "le");
  const params = [...scope.params];
  const territorySql = appendTerritoryAssignmentFilters(
    { entity: "legal_grouped", page: 1, pageSize: 1, q: "", ...territory },
    "le",
    params,
  );
  const groupKey = v3LegalGroupKeyExpr("le");
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count FROM (
        SELECT DISTINCT ${groupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${territorySql}
      ) grouped
    `,
    params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listV3LegalGrouped(
  context: AccessContext,
  input: V3ListQuery,
): Promise<{ total: number; items: Record<string, unknown>[] }> {
  const offset = (input.page - 1) * input.pageSize;

  const scope = v3EntityAssignmentScope(context, "le");
  const holdingScope = v3HoldingVisibilityScope(context, "h_vis");

  const countParams = [...scope.params];
  const territorySql = appendTerritoryAssignmentFilters(input, "le", countParams);
  const matchSql = appendEligibilityFilters(input, countParams, holdingScope);

  const groupKey = v3LegalGroupKeyExpr("le");
  const countResult = await query<{ count: string }>(
    `
      WITH scoped AS (
        SELECT le.guid_client, ${groupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${territorySql}
      ),
      eligible AS (
        SELECT DISTINCT s.group_key
        FROM onec_v3_legal_entities le
        INNER JOIN scoped s ON s.guid_client = le.guid_client
        WHERE TRUE${matchSql}
      )
      SELECT COUNT(*)::text AS count FROM eligible
    `,
    countParams,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);
  if (total === 0) {
    return { total: 0, items: [] };
  }

  const selectParams = [...scope.params];
  const selectTerritory = appendTerritoryAssignmentFilters(input, "le", selectParams);
  const selectMatch = appendEligibilityFilters(input, selectParams, holdingScope);

  const holdingScopeJoin = v3HoldingVisibilityScope(context, "h");
  selectParams.push(...holdingScopeJoin.params);
  const holdingVisibleClause = renumberScopeClause(
    holdingScopeJoin.clause,
    selectParams.length - holdingScopeJoin.params.length + 1,
  );
  selectParams.push(input.pageSize, offset);

  const rows = await query(
    `
      WITH scoped AS (
        SELECT le.*, ${groupKey} AS group_key
        FROM onec_v3_legal_entities le
        WHERE (${scope.clause})${selectTerritory}
      ),
      eligible AS (
        SELECT DISTINCT s.group_key
        FROM onec_v3_legal_entities le
        INNER JOIN scoped s ON s.guid_client = le.guid_client
        WHERE TRUE${selectMatch}
      ),
      page_groups AS (
        SELECT eg.group_key
        FROM eligible eg
        ORDER BY
          lower(CASE
            WHEN eg.group_key LIKE 'holding:%' THEN (
              SELECT COALESCE(
                NULLIF(TRIM(MAX(h_pg.name_holding)), ''),
                NULLIF(TRIM(MAX(s.name_holding)), ''),
                eg.group_key
              )
              FROM scoped s
              LEFT JOIN onec_v3_holdings h_pg
                ON h_pg.guid_holding = substring(eg.group_key from 9)::uuid
                AND (${holdingVisibleClause})
              WHERE s.group_key = eg.group_key
            )
            ELSE (SELECT MAX(s.name_client) FROM scoped s WHERE s.group_key = eg.group_key)
          END),
          eg.group_key ASC
        LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}
      ),
      members AS (
        SELECT s.*
        FROM scoped s
        INNER JOIN page_groups pg ON pg.group_key = s.group_key
      )
      SELECT
        pg.group_key,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN substring(pg.group_key from 9)
          ELSE (ARRAY_AGG(m.guid_client::text ORDER BY m.name_client ASC, m.guid_client ASC))[1]
        END AS guid,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN 'holding'
          ELSE 'legal'
        END AS detail_entity,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN MAX(h.name_holding)
          ELSE MAX(m.name_client)
        END AS name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN COALESCE(NULLIF(TRIM(MAX(${v3CategoryNameSql("h")})), ''), ${distinctOrMissing(v3CategoryNameSql("m"))})
          ELSE ${distinctOrMissing(v3CategoryNameSql("m"))}
        END AS category_name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN COALESCE(
              NULLIF(TRIM(MAX(${v3JsonManagerField("h", "nameManager")})), ''),
              ${distinctOrMissing(`m.managers->>'nameManager'`)}
            )
          ELSE ${distinctOrMissing(`m.managers->>'nameManager'`)}
        END AS manager_name,
        CASE
          WHEN pg.group_key LIKE 'holding:%' AND MAX(CASE WHEN h.guid_holding IS NOT NULL THEN 1 ELSE 0 END) = 1
            THEN COALESCE(
              NULLIF(TRIM(MAX(${v3JsonManagerField("h", "nameHeadOfSales")})), ''),
              ${distinctOrMissing(`m.managers->>'nameHeadOfSales'`)}
            )
          ELSE ${distinctOrMissing(`m.managers->>'nameHeadOfSales'`)}
        END AS rop_name,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('guid', m.guid_client::text, 'name', m.name_client)
            ORDER BY m.name_client ASC, m.guid_client ASC
          ),
          '[]'::jsonb
        ) AS legal_entities,
        MAX(m.guid_holding::text) AS holding_guid,
        MAX(m.type_category->>'nameType') AS type_name
      FROM page_groups pg
      INNER JOIN members m ON m.group_key = pg.group_key
      LEFT JOIN onec_v3_holdings h
        ON pg.group_key LIKE 'holding:%'
        AND h.guid_holding = substring(pg.group_key from 9)::uuid
        AND (${holdingVisibleClause})
      GROUP BY pg.group_key
      ORDER BY
        lower(CASE
          WHEN pg.group_key LIKE 'holding:%' THEN COALESCE(
            NULLIF(TRIM(MAX(h.name_holding)), ''),
            NULLIF(TRIM(MAX(m.name_holding)), ''),
            pg.group_key
          )
          ELSE MAX(m.name_client)
        END),
        pg.group_key ASC
    `,
    selectParams,
  );

  const items = rows.rows.map((row) => {
    const legalEntities = Array.isArray(row.legal_entities)
      ? row.legal_entities
      : typeof row.legal_entities === "string"
        ? JSON.parse(row.legal_entities)
        : [];
    return {
      group_key: row.group_key,
      guid: row.guid,
      detail_entity: row.detail_entity,
      name: row.name,
      category_name: row.category_name,
      manager_name: row.manager_name,
      rop_name: row.rop_name,
      legal_entities: legalEntities,
      holding_guid: row.holding_guid,
      type_name: row.type_name,
      legal_name: legalEntities.map((e: { name: string }) => e.name).join(", "),
    };
  });

  return { total, items };
}
