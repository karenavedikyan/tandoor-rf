import type { Pool, PoolClient } from "pg";
import {
  classifyHoldingCompositionSiteType,
  HOLDING_COMPOSITION_SITE_LABELS,
  type HoldingCompositionSiteType,
} from "../onec-clients/holding-v2-composition";
import { holdingV2PipelineEnabledEffective } from "../onec-clients/holding-v2-pipeline-config";

export type HoldingV2FieldPresentation = {
  value: string | null;
  hasSource: boolean;
  label: string;
  visibility: "visible" | "withheld" | "unknown";
};

export type HoldingV2ClientExchangeDto = {
  pipelineEnabled: boolean;
  hasStoredState: boolean;
  holdingRootGuid: string | null;
  isHoldingHead: boolean | null;
  compositionSiteType: HoldingCompositionSiteType;
  compositionLabel: string;
  typeCategory: {
    guidType?: HoldingV2FieldPresentation;
    nameType?: HoldingV2FieldPresentation;
    guidCategory?: HoldingV2FieldPresentation;
    nameCategory?: HoldingV2FieldPresentation;
  };
};

export type HoldingV2OutletExchangeDto = {
  typeCategory: {
    guidType?: HoldingV2FieldPresentation;
    nameType?: HoldingV2FieldPresentation;
    guidCategory?: HoldingV2FieldPresentation;
    nameCategory?: HoldingV2FieldPresentation;
  };
};

function presentStringField(
  hasPresence: boolean,
  value: string | null,
  visibility: "visible" | "withheld",
): HoldingV2FieldPresentation | undefined {
  if (!hasPresence) {
    return undefined;
  }
  if (visibility === "withheld") {
    return { value: null, hasSource: true, label: "Скрыто по области доступа", visibility: "withheld" };
  }
  const trimmed = value?.trim() ?? "";
  const empty = trimmed.length === 0;
  return {
    value: empty ? null : value,
    hasSource: true,
    label: empty ? "Не заполнено" : value!,
    visibility: "visible",
  };
}

function readTypeCategoryRow(row: {
  field_presence: Record<string, boolean> | null;
  guid_type: string | null;
  name_type: string | null;
  guid_category: string | null;
  name_category: string | null;
} | undefined, visibility: "visible" | "withheld"): HoldingV2OutletExchangeDto["typeCategory"] {
  if (!row) {
    return {};
  }
  const fp = row.field_presence ?? {};
  const result: HoldingV2OutletExchangeDto["typeCategory"] = {};
  const guidType = presentStringField(fp.guidType === true, row.guid_type, visibility);
  const nameType = presentStringField(fp.nameType === true, row.name_type, visibility);
  const guidCategory = presentStringField(fp.guidCategory === true, row.guid_category, visibility);
  const nameCategory = presentStringField(fp.nameCategory === true, row.name_category, visibility);
  if (guidType) result.guidType = guidType;
  if (nameType) result.nameType = nameType;
  if (guidCategory) result.guidCategory = guidCategory;
  if (nameCategory) result.nameCategory = nameCategory;
  return result;
}

async function loadApplyState(client: Pool | PoolClient): Promise<boolean> {
  const result = await client.query<{ last_normalized_state_sha256: string | null }>(
    `SELECT last_normalized_state_sha256 FROM onec_holding_v2_apply_state WHERE id = 1`,
  );
  return Boolean(result.rows[0]?.last_normalized_state_sha256);
}

export async function loadHoldingV2ClientExchange(
  client: Pool | PoolClient,
  guidClient: string,
  options: { visibility: "visible" | "withheld" },
): Promise<HoldingV2ClientExchangeDto | null> {
  const pipelineEnabled = holdingV2PipelineEnabledEffective();
  const hasStoredState = await loadApplyState(client);
  if (!hasStoredState) {
    return null;
  }

  const legal = await client.query<{
    guid_holding_root: string;
    is_holding_head: boolean;
  }>(
    `
      SELECT guid_holding_root::text, is_holding_head
      FROM onec_holding_v2_legal_links
      WHERE guid_client = $1::uuid AND link_active = TRUE
    `,
    [guidClient],
  );
  const legalRow = legal.rows[0];
  const holdingRootGuid = legalRow?.guid_holding_root ?? null;

  let compositionSiteType: HoldingCompositionSiteType = "unknown";
  if (holdingRootGuid) {
    const counts = await client.query<{ legal_count: string; active_outlets: string; has_head: boolean }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM onec_holding_v2_legal_links
           WHERE guid_holding_root = $1::uuid AND link_active = TRUE) AS legal_count,
          (SELECT COUNT(*)::text FROM onec_holding_v2_outlet_links
           WHERE guid_holding_root = $1::uuid AND link_active = TRUE
             AND (closure_known = FALSE OR is_closed = FALSE)) AS active_outlets,
          EXISTS (
            SELECT 1 FROM onec_holding_v2_legal_links
            WHERE guid_holding_root = $1::uuid AND guid_client = $1::uuid
              AND link_active = TRUE AND is_holding_head = TRUE
          ) AS has_head
      `,
      [holdingRootGuid],
    );
    const row = counts.rows[0];
    const legalEntityCount = Number(row?.legal_count ?? 0);
    const activeOutletCount = Number(row?.active_outlets ?? 0);
    const membershipComplete = row?.has_head === true;
    compositionSiteType = classifyHoldingCompositionSiteType({
      legalEntityCount,
      activeOutletCount,
      membershipComplete,
      compositionDataComplete: membershipComplete,
    });
  }

  const tc = await client.query<{
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
  }>(
    `
      SELECT guid_type, name_type, guid_category, name_category, field_presence
      FROM onec_holding_v2_client_type_category
      WHERE guid_client = $1::uuid
    `,
    [guidClient],
  );

  return {
    pipelineEnabled,
    hasStoredState,
    holdingRootGuid,
    isHoldingHead: legalRow?.is_holding_head ?? null,
    compositionSiteType,
    compositionLabel: HOLDING_COMPOSITION_SITE_LABELS[compositionSiteType],
    typeCategory: readTypeCategoryRow(tc.rows[0], options.visibility),
  };
}

export async function loadHoldingV2OutletExchange(
  client: Pool | PoolClient,
  guidStore: string,
  options: { visibility: "visible" | "withheld" },
): Promise<HoldingV2OutletExchangeDto | null> {
  const hasStoredState = await loadApplyState(client);
  if (!hasStoredState) {
    return null;
  }
  const tc = await client.query<{
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
  }>(
    `
      SELECT guid_type, name_type, guid_category, name_category, field_presence
      FROM onec_holding_v2_outlet_type_category
      WHERE guid_store = $1::uuid
    `,
    [guidStore],
  );
  if (tc.rows.length === 0) {
    return null;
  }
  return { typeCategory: readTypeCategoryRow(tc.rows[0], options.visibility) };
}

export async function loadHoldingV2ListSummaries(
  client: Pool | PoolClient,
  guidClients: string[],
): Promise<Map<string, Pick<HoldingV2ClientExchangeDto, "compositionLabel" | "typeCategory">>> {
  const map = new Map<string, Pick<HoldingV2ClientExchangeDto, "compositionLabel" | "typeCategory">>();
  if (guidClients.length === 0) {
    return map;
  }
  const hasStoredState = await loadApplyState(client);
  if (!hasStoredState) {
    return map;
  }

  const legalRows = await client.query<{ guid_client: string; guid_holding_root: string }>(
    `
      SELECT guid_client::text, guid_holding_root::text
      FROM onec_holding_v2_legal_links
      WHERE link_active = TRUE AND guid_client = ANY($1::uuid[])
    `,
    [guidClients],
  );
  const rootByClient = new Map(legalRows.rows.map((r) => [r.guid_client.toLowerCase(), r.guid_holding_root]));

  const tcRows = await client.query<{
    guid_client: string;
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
  }>(
    `
      SELECT guid_client::text, guid_type, name_type, guid_category, name_category, field_presence
      FROM onec_holding_v2_client_type_category
      WHERE guid_client = ANY($1::uuid[])
    `,
    [guidClients],
  );
  const tcByClient = new Map(tcRows.rows.map((r) => [r.guid_client.toLowerCase(), r]));

  for (const guid of guidClients) {
    const key = guid.toLowerCase();
    const root = rootByClient.get(key);
    let compositionLabel = HOLDING_COMPOSITION_SITE_LABELS.unknown;
    if (root) {
      const counts = await client.query<{ legal_count: string; active_outlets: string; has_head: boolean }>(
        `
          SELECT
            (SELECT COUNT(*)::text FROM onec_holding_v2_legal_links
             WHERE guid_holding_root = $1::uuid AND link_active = TRUE) AS legal_count,
            (SELECT COUNT(*)::text FROM onec_holding_v2_outlet_links
             WHERE guid_holding_root = $1::uuid AND link_active = TRUE
               AND (closure_known = FALSE OR is_closed = FALSE)) AS active_outlets,
            EXISTS (
              SELECT 1 FROM onec_holding_v2_legal_links
              WHERE guid_holding_root = $1::uuid AND guid_client = $1::uuid
                AND link_active = TRUE AND is_holding_head = TRUE
            ) AS has_head
        `,
        [root],
      );
      const row = counts.rows[0];
      const siteType = classifyHoldingCompositionSiteType({
        legalEntityCount: Number(row?.legal_count ?? 0),
        activeOutletCount: Number(row?.active_outlets ?? 0),
        membershipComplete: row?.has_head === true,
        compositionDataComplete: row?.has_head === true,
      });
      compositionLabel = HOLDING_COMPOSITION_SITE_LABELS[siteType];
    }
    map.set(key, {
      compositionLabel,
      typeCategory: readTypeCategoryRow(tcByClient.get(key), "visible"),
    });
  }
  return map;
}
