import type { PoolClient } from "pg";
import type { HoldingV2PersistedState } from "./types";

export async function loadHoldingV2PersistedState(client: PoolClient): Promise<HoldingV2PersistedState> {
  const legal = await client.query<{
    guid_client: string;
    guid_holding_root: string;
    is_holding_head: boolean;
    link_active: boolean;
  }>(
    `
      SELECT guid_client::text, guid_holding_root::text, is_holding_head, link_active
      FROM onec_holding_v2_legal_links
    `,
  );
  const outlets = await client.query<{
    guid_store: string;
    guid_holding_root: string;
    is_closed: boolean | null;
    closure_known: boolean;
    link_active: boolean;
  }>(
    `
      SELECT guid_store::text, guid_holding_root::text, is_closed, closure_known, link_active
      FROM onec_holding_v2_outlet_links
    `,
  );
  const clientTc = await client.query<{
    guid_client: string;
    object_present_in_source: boolean;
    field_presence: Record<string, boolean>;
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
  }>(
    `
      SELECT guid_client::text, object_present_in_source, field_presence,
             guid_type, name_type, guid_category, name_category
      FROM onec_holding_v2_client_type_category
    `,
  );
  const outletTc = await client.query<{
    guid_store: string;
    object_present_in_source: boolean;
    field_presence: Record<string, boolean>;
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
  }>(
    `
      SELECT guid_store::text, object_present_in_source, field_presence,
             guid_type, name_type, guid_category, name_category
      FROM onec_holding_v2_outlet_type_category
    `,
  );

  return {
    legalLinks: legal.rows.map((r) => ({
      guidClient: r.guid_client.toLowerCase(),
      guidHoldingRoot: r.guid_holding_root.toLowerCase(),
      isHoldingHead: r.is_holding_head,
      linkActive: r.link_active,
    })),
    outletLinks: outlets.rows.map((r) => ({
      guidStore: r.guid_store.toLowerCase(),
      guidHoldingRoot: r.guid_holding_root.toLowerCase(),
      isClosed: r.is_closed,
      closureKnown: r.closure_known,
      linkActive: r.link_active,
    })),
    clientTypeCategories: clientTc.rows.map((r) => ({
      guidClient: r.guid_client.toLowerCase(),
      objectPresentInSource: r.object_present_in_source,
      fieldPresence: r.field_presence ?? {},
      guidType: r.guid_type,
      nameType: r.name_type,
      guidCategory: r.guid_category,
      nameCategory: r.name_category,
    })),
    outletTypeCategories: outletTc.rows.map((r) => ({
      guidStore: r.guid_store.toLowerCase(),
      objectPresentInSource: r.object_present_in_source,
      fieldPresence: r.field_presence ?? {},
      guidType: r.guid_type,
      nameType: r.name_type,
      guidCategory: r.guid_category,
      nameCategory: r.name_category,
    })),
  };
}

export async function assertOnecClientsExist(
  client: PoolClient,
  clientGuids: string[],
): Promise<string[]> {
  if (clientGuids.length === 0) {
    return [];
  }
  const result = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
    `,
    [clientGuids],
  );
  const found = new Set(result.rows.map((r) => r.guid_client.toLowerCase()));
  return clientGuids.filter((g) => !found.has(g.toLowerCase()));
}
