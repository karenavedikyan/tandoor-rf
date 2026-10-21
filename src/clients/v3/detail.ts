import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { otherFieldsBagCompleteForSource } from "../../onec-exchange-v3/other-fields-presence";
import { presentLegalOtherFieldsForApi } from "../../onec-exchange-v3/sanitize-client-other";
import { v3JsonManagerField } from "./json-paths";
import {
  v3EntityAssignmentScope,
  v3HoldingMemberLegalScope,
  v3HoldingMemberRetailScope,
  v3HoldingVisibilityScope,
  type V3EntityKind,
} from "./access-scope";

export type V3DetailEntity = "holding" | "legal" | "retail";

export type V3EntityAccess = "visible" | "withheld" | "unknown";

export type V3CompositionTerritory = {
  responsibleGuid?: string;
  responsibleKind?: "manager" | "regional" | "hardware";
  ropBranchGuid?: string;
};

/** Additional selected-territory restriction; never replaces session access/denials. */
export function v3CompositionTerritorySql(
  alias: string,
  territory: V3CompositionTerritory,
  params: unknown[],
): string {
  let sql = "";
  if (territory.responsibleGuid) {
    const field = territory.responsibleKind === "regional"
      ? "guidRegionalManager"
      : territory.responsibleKind === "hardware" ? "guidHardwareManager" : "guidManager";
    params.push(territory.responsibleGuid);
    sql += ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, field)}, '')), '')::uuid = $${params.length}::uuid`;
  }
  if (territory.ropBranchGuid) {
    params.push(territory.ropBranchGuid);
    sql += ` AND NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHeadOfSales")}, '')), '')::uuid = $${params.length}::uuid`;
  }
  return sql;
}

function tableForEntity(entity: V3DetailEntity): {
  table: string;
  guidColumn: string;
  kind: V3EntityKind;
} {
  if (entity === "holding") {
    return { table: "onec_v3_holdings", guidColumn: "guid_holding", kind: "holding" };
  }
  if (entity === "legal") {
    return { table: "onec_v3_legal_entities", guidColumn: "guid_client", kind: "legal" };
  }
  return { table: "onec_v3_retail_outlets", guidColumn: "guid_store", kind: "retail" };
}

export async function resolveV3EntityAccess(
  context: AccessContext,
  entity: V3DetailEntity,
  guid: string,
): Promise<V3EntityAccess> {
  const meta = tableForEntity(entity);
  const exists = await query(
    `SELECT 1 FROM ${meta.table} WHERE ${meta.guidColumn} = $1::uuid LIMIT 1`,
    [guid],
  );
  if (exists.rows.length === 0) {
    return "unknown";
  }

  const alias = entity === "holding" ? "h" : entity === "legal" ? "le" : "ro";
  const scope =
    entity === "holding"
      ? v3HoldingVisibilityScope(context, alias)
      : v3EntityAssignmentScope(context, alias, meta.kind);

  const scopedClause = scope.clause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + 1}`);
  const visible = await query(
    `SELECT 1 FROM ${meta.table} AS ${alias} WHERE ${alias}.${meta.guidColumn} = $1::uuid AND (${scopedClause}) LIMIT 1`,
    [guid, ...scope.params],
  );
  return visible.rows.length > 0 ? "visible" : "withheld";
}

export async function getV3HoldingDetail(context: AccessContext, guid: string) {
  const access = await resolveV3EntityAccess(context, "holding", guid);
  if (access !== "visible") {
    return { access };
  }
  const row = await query(
    `
      SELECT h.guid_holding::text AS guid,
             h.name_holding AS name,
             h.type_category,
             h.retail_chain,
             h.holding_group,
             h.managers,
             h.last_imported_at,
             h.last_source_sha256
      FROM onec_v3_holdings h
      WHERE h.guid_holding = $1::uuid
    `,
    [guid],
  );
  return { access: "visible" as const, entity: row.rows[0] };
}

export async function getV3LegalDetail(context: AccessContext, guid: string) {
  const access = await resolveV3EntityAccess(context, "legal", guid);
  if (access !== "visible") {
    return { access };
  }
  const row = await query(
    `
      SELECT le.guid_client::text AS guid,
             le.name_client AS name,
             le.inn,
             le.kpp,
             le.guid_holding::text AS holding_guid,
             le.name_holding AS holding_name,
             le.type_category,
             le.managers,
             le.address,
             le.telephone,
             le.discount,
             le.discount_amount,
             le.markups,
             le.other_fields,
             le.membership_conflict,
             le.last_imported_at,
             le.last_source_sha256
      FROM onec_v3_legal_entities le
      WHERE le.guid_client = $1::uuid
    `,
    [guid],
  );
  let holdingLink: { guid: string; name: string } | null = null;
  const holdingGuid = row.rows[0]?.holding_guid as string | null;
  if (holdingGuid) {
    const holdingAccess = await resolveV3EntityAccess(context, "holding", holdingGuid);
    if (holdingAccess === "visible") {
      holdingLink = { guid: holdingGuid, name: String(row.rows[0]?.holding_name ?? "") };
    }
  }
  const entityRow = row.rows[0] as Record<string, unknown>;
  const rawOther = entityRow.other_fields as Record<string, unknown> | undefined;
  const entity = {
    ...entityRow,
    other_fields_exchange_complete: otherFieldsBagCompleteForSource(
      rawOther,
      entityRow.last_source_sha256 as string | null | undefined,
    ),
    other_fields: presentLegalOtherFieldsForApi(rawOther, context),
  };
  return { access: "visible" as const, entity, holdingLink };
}

export async function getV3RetailDetail(context: AccessContext, guid: string) {
  const access = await resolveV3EntityAccess(context, "retail", guid);
  if (access !== "visible") {
    return { access };
  }
  const row = await query(
    `
      SELECT ro.guid_store::text AS guid,
             ro.guid_holding::text AS holding_guid,
             ro.warehouse,
             ro.closed,
             ro.type_category,
             ro.address,
             ro.information_loading,
             ro.managers,
             ro.contact_information,
             ro.lpr_information,
             ro.additional_information,
             ro.membership_conflict,
             ro.last_imported_at,
             ro.last_source_sha256
      FROM onec_v3_retail_outlets ro
      WHERE ro.guid_store = $1::uuid
    `,
    [guid],
  );
  let holdingLink: { guid: string; name: string } | null = null;
  const holdingGuid = row.rows[0]?.holding_guid as string | null;
  if (holdingGuid) {
    const holdingAccess = await resolveV3EntityAccess(context, "holding", holdingGuid);
    if (holdingAccess === "visible") {
      const h = await query<{ name_holding: string }>(
        `SELECT name_holding FROM onec_v3_holdings WHERE guid_holding = $1::uuid`,
        [holdingGuid],
      );
      holdingLink = { guid: holdingGuid, name: h.rows[0]?.name_holding ?? "" };
    }
  }
  return { access: "visible" as const, entity: row.rows[0], holdingLink };
}

export async function getV3HoldingComposition(
  context: AccessContext,
  holdingGuid: string,
  territory: V3CompositionTerritory = {},
) {
  const access = await resolveV3EntityAccess(context, "holding", holdingGuid);
  if (access !== "visible") {
    return { access };
  }

  const legalScope = v3HoldingMemberLegalScope(context, "le");
  const retailScope = v3HoldingMemberRetailScope(context, "ro");
  const legalParams = [...legalScope.params, holdingGuid];
  const legalHoldingParam = legalParams.length;
  const legalTerritory = v3CompositionTerritorySql("le", territory, legalParams);
  const legal = await query(
    `
      SELECT le.guid_client::text AS guid, le.name_client AS name, le.inn, le.kpp, le.type_category
      FROM onec_v3_legal_entities le
      WHERE le.guid_holding = $${legalHoldingParam}::uuid AND (${legalScope.clause})${legalTerritory}
      ORDER BY le.name_client ASC
    `,
    legalParams,
  );
  const retailParams = [...retailScope.params, holdingGuid];
  const retailHoldingParam = retailParams.length;
  const retailTerritory = v3CompositionTerritorySql("ro", territory, retailParams);
  const retail = await query(
    `
      SELECT ro.guid_store::text AS guid,
             COALESCE(ro.address->>'store_address', ro.guid_store::text) AS name,
             ro.closed,
             ro.type_category
      FROM onec_v3_retail_outlets ro
      WHERE ro.guid_holding = $${retailHoldingParam}::uuid AND (${retailScope.clause})${retailTerritory}
      ORDER BY name ASC
    `,
    retailParams,
  );

  return {
    access: "visible" as const,
    holdingGuid,
    legalEntities: legal.rows,
    retailOutlets: retail.rows,
  };
}
