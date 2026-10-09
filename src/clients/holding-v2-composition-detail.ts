import type { Pool, PoolClient } from "pg";
import { combineScopeAndFilter } from "../access/combine-filters";
import { buildClientScopeSql } from "../access/scope-sql";
import type { AccessContext } from "../access/types";
import { buildOutletScope, outletStoreAddressSql } from "./outlets/scope-sql";
import type { HoldingV2FieldPresentation, HoldingV2OutletExchangeDto } from "./holding-v2-exchange";
import { readTypeCategoryRow } from "./holding-v2-exchange";
import { resolveHoldingV2CompositionVisibility } from "./holding-v2-scope";

export type HoldingV2CompositionAccessKind = "visible" | "withheld" | "incomplete_source";

export type HoldingV2CompositionAccessDto = {
  kind: HoldingV2CompositionAccessKind;
};

export type HoldingV2CompositionOutletDto = {
  guidStore: string;
  label: string;
  guidClient: string;
  isClosed: boolean | null;
  closureKnown: boolean;
  holdingV2?: HoldingV2OutletExchangeDto | null;
};

export type HoldingV2CompositionLegalEntityDto = {
  guidClient: string;
  nameClient: string;
  isHoldingHead: boolean;
  typeCategory: {
    nameType?: HoldingV2FieldPresentation;
    nameCategory?: HoldingV2FieldPresentation;
    guidType?: HoldingV2FieldPresentation;
    guidCategory?: HoldingV2FieldPresentation;
  };
};

export type HoldingV2CompositionDetailDto = {
  holdingRootGuid: string;
  legalEntities: HoldingV2CompositionLegalEntityDto[];
  outlets: HoldingV2CompositionOutletDto[];
};

function outletLabel(storeAddress: string | null, guidStore: string): string {
  const trimmed = storeAddress?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : `ТТ ${guidStore.slice(0, 8)}…`;
}

export async function loadHoldingV2CompositionAccess(
  context: AccessContext,
  client: Pool | PoolClient,
  holdingRootGuid: string | null,
  compositionDataComplete: boolean,
): Promise<HoldingV2CompositionAccessDto> {
  if (!holdingRootGuid) {
    return { kind: "incomplete_source" };
  }
  const visibility = await resolveHoldingV2CompositionVisibility(context, client, holdingRootGuid);
  if (visibility === "withheld") {
    return { kind: "withheld" };
  }
  if (!compositionDataComplete) {
    return { kind: "incomplete_source" };
  }
  return { kind: "visible" };
}

export async function loadHoldingV2CompositionDetail(
  context: AccessContext,
  client: Pool | PoolClient,
  holdingRootGuid: string,
): Promise<HoldingV2CompositionDetailDto | null> {
  const visibility = await resolveHoldingV2CompositionVisibility(context, client, holdingRootGuid);
  if (visibility === "withheld") {
    return null;
  }

  const memberRows = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_holding_v2_legal_links
      WHERE guid_holding_root = $1::uuid AND link_active = TRUE
    `,
    [holdingRootGuid],
  );
  const memberGuids = memberRows.rows.map((r) => r.guid_client);
  if (memberGuids.length === 0) {
    return null;
  }

  const scope = buildClientScopeSql(context);
  const legalScope = combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_client = ANY($1::uuid[])",
    params: [memberGuids],
  });

  const legalMemberFilterSql = legalScope.whereSql
    ? `
        AND ll.guid_client IN (
          SELECT guid_client FROM onec_clients ${legalScope.whereSql.replace(/^WHERE\s+/i, "WHERE ")}
        )
      `
    : "";

  const legalRows = await client.query<{
    guid_client: string;
    name_client: string;
    is_holding_head: boolean;
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
  }>(
    `
      SELECT
        ll.guid_client::text,
        oc.name_client,
        ll.is_holding_head,
        tc.guid_type,
        tc.name_type,
        tc.guid_category,
        tc.name_category,
        tc.field_presence
      FROM onec_holding_v2_legal_links ll
      INNER JOIN onec_clients oc ON oc.guid_client = ll.guid_client
      LEFT JOIN onec_holding_v2_client_type_category tc ON tc.guid_client = ll.guid_client
      WHERE ll.guid_holding_root = $${legalScope.params.length + 1}::uuid
        AND ll.link_active = TRUE
        ${legalMemberFilterSql}
      ORDER BY ll.is_holding_head DESC, oc.name_client ASC, ll.guid_client ASC
    `,
    [...legalScope.params, holdingRootGuid],
  );

  if (legalRows.rows.length === 0) {
    return null;
  }

  const outletScope = buildOutletScope(context);
  const storeAddressExpr = outletStoreAddressSql("ro", "oc");
  const outletRows = await client.query<{
    guid_store: string;
    guid_client: string;
    store_address: string | null;
    is_closed: boolean | null;
    closure_known: boolean;
  }>(
    `
      SELECT
        ro.guid_store::text,
        ro.guid_client::text,
        ${storeAddressExpr} AS store_address,
        ol.is_closed,
        ol.closure_known
      FROM onec_holding_v2_outlet_links ol
      INNER JOIN onec_retail_outlets ro ON ro.guid_store = ol.guid_store
      INNER JOIN onec_clients oc ON oc.guid_client = ro.guid_client
      ${outletScope.whereSql}
        AND ol.guid_holding_root = $${outletScope.params.length + 1}::uuid
        AND ol.link_active = TRUE
      ORDER BY store_address ASC NULLS LAST, ro.guid_store ASC
    `,
    [...outletScope.params, holdingRootGuid],
  );

  const outletStoreGuids = outletRows.rows.map((row) => row.guid_store);
  const outletTypeByStore = new Map<
    string,
    {
      guid_type: string | null;
      name_type: string | null;
      guid_category: string | null;
      name_category: string | null;
      field_presence: Record<string, boolean>;
    }
  >();
  if (outletStoreGuids.length > 0) {
    const outletTcRows = await client.query<{
      guid_store: string;
      guid_type: string | null;
      name_type: string | null;
      guid_category: string | null;
      name_category: string | null;
      field_presence: Record<string, boolean>;
    }>(
      `
        SELECT guid_store::text, guid_type, name_type, guid_category, name_category, field_presence
        FROM onec_holding_v2_outlet_type_category
        WHERE guid_store = ANY($1::uuid[])
      `,
      [outletStoreGuids],
    );
    for (const row of outletTcRows.rows) {
      outletTypeByStore.set(row.guid_store.toLowerCase(), row);
    }
  }

  const outlets: HoldingV2CompositionOutletDto[] = outletRows.rows.map((row) => {
    const tcRow = outletTypeByStore.get(row.guid_store.toLowerCase());
    const outletV2: HoldingV2OutletExchangeDto | null = tcRow
      ? { typeCategory: readTypeCategoryRow(tcRow, "visible") }
      : null;
    return {
      guidStore: row.guid_store,
      label: outletLabel(row.store_address, row.guid_store),
      guidClient: row.guid_client,
      isClosed: row.is_closed,
      closureKnown: row.closure_known,
      holdingV2: outletV2,
    };
  });

  const legalEntities: HoldingV2CompositionLegalEntityDto[] = [];
  const seenHead = new Set<string>();
  for (const row of legalRows.rows) {
    if (row.is_holding_head) {
      if (seenHead.has(holdingRootGuid.toLowerCase())) {
        continue;
      }
      seenHead.add(holdingRootGuid.toLowerCase());
    }
    legalEntities.push({
      guidClient: row.guid_client,
      nameClient: row.name_client,
      isHoldingHead: row.is_holding_head,
      typeCategory: readTypeCategoryRow(
        {
          field_presence: row.field_presence,
          guid_type: row.guid_type,
          name_type: row.name_type,
          guid_category: row.guid_category,
          name_category: row.name_category,
        },
        "visible",
      ),
    });
  }

  return {
    holdingRootGuid,
    legalEntities,
    outlets,
  };
}
