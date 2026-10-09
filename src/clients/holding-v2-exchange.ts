import type { Pool, PoolClient } from "pg";
import {
  classifyHoldingCompositionSiteType,
  HOLDING_COMPOSITION_SITE_LABELS,
  type HoldingCompositionSiteType,
} from "../onec-clients/holding-v2-composition";
import type { AccessContext } from "../access/types";
import { holdingV2PipelineEnabledEffective } from "../onec-clients/holding-v2-pipeline-config";
import { resolveHoldingV2CompositionVisibility } from "./holding-v2-scope";
import type {
  HoldingV2CompositionAccessDto,
  HoldingV2CompositionDetailDto,
} from "./holding-v2-composition-detail";

const WITHHELD_COMPOSITION_LABEL = "Скрыто по области доступа";

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
  compositionAccess: HoldingV2CompositionAccessDto;
  compositionDetail: HoldingV2CompositionDetailDto | null;
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

type HoldingV2TypeCategoryBlock = HoldingV2ClientExchangeDto["typeCategory"];

export function pickHoldingV2ReadableNameTypeLabel(typeCategory: HoldingV2TypeCategoryBlock): string | undefined {
  const name = typeCategory.nameType?.label?.trim();
  if (name && name !== "Не заполнено") {
    return name;
  }
  return undefined;
}

export function pickHoldingV2ReadableNameCategoryLabel(
  typeCategory: HoldingV2TypeCategoryBlock,
): string | undefined {
  const name = typeCategory.nameCategory?.label?.trim();
  if (name && name !== "Не заполнено") {
    return name;
  }
  return undefined;
}

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

export function readTypeCategoryRow(row: {
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

async function loadCompositionCounts(
  client: Pool | PoolClient,
  holdingRootGuid: string,
): Promise<{
  legalEntityCount: number;
  activeOutletCount: number;
  membershipComplete: boolean;
  compositionDataComplete: boolean;
}> {
  const counts = await client.query<{
    legal_count: string;
    active_outlets: string;
    unknown_closure_outlets: string;
    has_head: boolean;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::text FROM onec_holding_v2_legal_links
         WHERE guid_holding_root = $1::uuid AND link_active = TRUE) AS legal_count,
        (SELECT COUNT(*)::text FROM onec_holding_v2_outlet_links
         WHERE guid_holding_root = $1::uuid AND link_active = TRUE
           AND closure_known = TRUE AND is_closed = FALSE) AS active_outlets,
        (SELECT COUNT(*)::text FROM onec_holding_v2_outlet_links
         WHERE guid_holding_root = $1::uuid AND link_active = TRUE
           AND closure_known = FALSE) AS unknown_closure_outlets,
        EXISTS (
          SELECT 1 FROM onec_holding_v2_legal_links
          WHERE guid_holding_root = $1::uuid AND guid_client = $1::uuid
            AND link_active = TRUE AND is_holding_head = TRUE
        ) AS has_head
    `,
    [holdingRootGuid],
  );
  const row = counts.rows[0];
  const unknownClosure = Number(row?.unknown_closure_outlets ?? 0);
  const membershipComplete = row?.has_head === true;
  return {
    legalEntityCount: Number(row?.legal_count ?? 0),
    activeOutletCount: Number(row?.active_outlets ?? 0),
    membershipComplete,
    compositionDataComplete: membershipComplete && unknownClosure === 0,
  };
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
  options: {
    context?: AccessContext;
    typeCategoryVisibility?: "visible" | "withheld";
  },
): Promise<HoldingV2ClientExchangeDto | null> {
  const typeCategoryVisibility = options.typeCategoryVisibility ?? "visible";
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

  const compositionVisibility =
    options.context && holdingRootGuid
      ? await resolveHoldingV2CompositionVisibility(options.context, client, holdingRootGuid)
      : ("visible" as const);

  let compositionSiteType: HoldingCompositionSiteType = "unknown";
  let compositionLabel = HOLDING_COMPOSITION_SITE_LABELS.unknown;
  let exposedRootGuid: string | null = holdingRootGuid;
  let exposedIsHead: boolean | null = legalRow?.is_holding_head ?? null;
  let compositionDataComplete = false;
  let compositionAccess: HoldingV2CompositionAccessDto = { kind: "incomplete_source" };
  let compositionDetail: HoldingV2CompositionDetailDto | null = null;

  if (compositionVisibility === "withheld") {
    compositionSiteType = "unknown";
    compositionLabel = WITHHELD_COMPOSITION_LABEL;
    exposedRootGuid = null;
    exposedIsHead = null;
    compositionAccess = { kind: "withheld" };
  } else if (holdingRootGuid) {
    const counts = await loadCompositionCounts(client, holdingRootGuid);
    compositionDataComplete = counts.compositionDataComplete;
    compositionSiteType = classifyHoldingCompositionSiteType(counts);
    compositionLabel = HOLDING_COMPOSITION_SITE_LABELS[compositionSiteType];
    if (options.context) {
      const compositionModule = await import("./holding-v2-composition-detail");
      compositionAccess = await compositionModule.loadHoldingV2CompositionAccess(
        options.context,
        client,
        holdingRootGuid,
        compositionDataComplete,
      );
      if (compositionAccess.kind !== "withheld") {
        compositionDetail = await compositionModule.loadHoldingV2CompositionDetail(
          options.context,
          client,
          holdingRootGuid,
        );
      }
    } else {
      compositionAccess = { kind: "incomplete_source" };
    }
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
    holdingRootGuid: exposedRootGuid,
    isHoldingHead: exposedIsHead,
    compositionSiteType,
    compositionLabel,
    compositionAccess,
    compositionDetail,
    typeCategory: readTypeCategoryRow(tc.rows[0], typeCategoryVisibility),
  };
}

export async function loadHoldingV2OutletExchange(
  client: Pool | PoolClient,
  guidStore: string,
  options: { typeCategoryVisibility?: "visible" | "withheld" },
): Promise<HoldingV2OutletExchangeDto | null> {
  const typeCategoryVisibility = options.typeCategoryVisibility ?? "visible";
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
  return { typeCategory: readTypeCategoryRow(tc.rows[0], typeCategoryVisibility) };
}

export async function loadHoldingV2ListSummaries(
  client: Pool | PoolClient,
  context: AccessContext,
  guidClients: string[],
): Promise<
  Map<
    string,
    Pick<HoldingV2ClientExchangeDto, "compositionLabel" | "typeCategory"> & {
      nameTypeLabel?: string;
      nameCategoryLabel?: string;
    }
  >
> {
  const map = new Map<
    string,
    Pick<HoldingV2ClientExchangeDto, "compositionLabel" | "typeCategory"> & {
      nameTypeLabel?: string;
      nameCategoryLabel?: string;
    }
  >();
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
      const compositionVisibility = await resolveHoldingV2CompositionVisibility(context, client, root);
      if (compositionVisibility === "withheld") {
        compositionLabel = WITHHELD_COMPOSITION_LABEL;
      } else {
        const counts = await loadCompositionCounts(client, root);
        compositionLabel = HOLDING_COMPOSITION_SITE_LABELS[classifyHoldingCompositionSiteType(counts)];
      }
    }
    const typeCategory = readTypeCategoryRow(tcByClient.get(key), "visible");
    map.set(key, {
      compositionLabel,
      typeCategory,
      nameTypeLabel: pickHoldingV2ReadableNameTypeLabel(typeCategory),
      nameCategoryLabel: pickHoldingV2ReadableNameCategoryLabel(typeCategory),
    });
  }
  return map;
}
