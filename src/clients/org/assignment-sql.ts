import { MANAGER_ROSTER_SCOPE_ALLOWED_SQL } from "../../onec-clients/manager-status";
import { RETAIL_OUTLETS_JSON, RETAIL_OUTLETS_JSON_OC } from "../team-portfolio-sql";

export { RETAIL_OUTLETS_JSON, RETAIL_OUTLETS_JSON_OC };

export function clientHeadOfSalesGuidSql(clientAlias = "onec_clients"): string {
  return `NULLIF(BTRIM(lower(${clientAlias}.extended_snapshot->'headOfSales'->>'guid')), '')`;
}

export function clientHeadOfSalesNameSql(clientAlias = "onec_clients"): string {
  return `NULLIF(BTRIM(${clientAlias}.extended_snapshot->'headOfSales'->>'name'), '')`;
}

export function outletHeadOfSalesGuidSql(outletAlias = "outlet"): string {
  return `NULLIF(BTRIM(lower(${outletAlias}->'managers'->'headOfSales'->>'guid')), '')`;
}

export function outletManagerGuidSql(outletAlias = "outlet"): string {
  return `NULLIF(BTRIM(lower(${outletAlias}->'managers'->'manager'->>'guid')), '')`;
}

export function outletManagerStateSql(outletAlias = "outlet"): string {
  return `COALESCE(${outletAlias}->'managers'->'manager'->>'state', '')`;
}

export function outletHardwareStateSql(outletAlias = "outlet"): string {
  return `COALESCE(${outletAlias}->'managers'->'hardwareManager'->>'state', '')`;
}

/** Client has at least one outlet with sales manager assignment in extended snapshot. */
export function managerSalesOutletsExistClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias)}) outlet(elem)
      WHERE ${outletManagerGuidSql("outlet.elem")} = lower(${managerParamSql}::text)
    )
  `;
}

/** Client has at least one outlet with hardware manager assignment in extended snapshot. */
export function managerHardwareOutletsExistClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias)}) outlet(elem)
      WHERE ${outletHardwareGuidSql("outlet.elem")} = lower(${managerParamSql}::text)
    )
  `;
}

/** @deprecated Use managerSalesOutletsExistClause */
export const managerAssignedOutletsExistClause = managerSalesOutletsExistClause;

/** Client list: direct client-level sales or hardware assignment only. */
export function managerDirectClientListClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
): string {
  const rosterSql = MANAGER_ROSTER_SCOPE_ALLOWED_SQL.replaceAll("onec_clients.", `${clientAlias}.`);
  return `(
    (lower(${clientAlias}.guid_manager::text) = lower(${managerParamSql}::text) AND ${rosterSql})
    OR ${clientHardwareGuidSql(clientAlias)} = lower(${managerParamSql}::text)
  )`;
}

/**
 * Card/outlet-parent read scope: direct client assignments plus outlet-only parents
 * reachable via sales or hardware TT assignment.
 */
export function managerFullClientReadClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `(
    ${managerDirectClientListClause(managerParamSql, clientAlias)}
    OR ${managerSalesOutletsExistClause(managerParamSql, clientAlias)}
    OR ${managerHardwareOutletsExistClause(managerParamSql, clientAlias)}
  )`;
}

/** @deprecated Use managerFullClientReadClause */
export const managerClientPortfolioClause = managerFullClientReadClause;

/**
 * Outlet on a client-assigned manager parent without a conflicting outlet-level manager assignment.
 * Outlets explicitly assigned to another manager stay excluded.
 */
export function outletInheritedFromClientManagerClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
  outletAlias = "outlet.elem",
): string {
  return `(
    lower(${clientAlias}.guid_manager::text) = lower(${managerParamSql}::text)
    AND (
      ${outletManagerGuidSql(outletAlias)} IS NULL
      OR ${outletManagerStateSql(outletAlias)} IN ('unassigned', 'invalid', 'not_provided')
    )
  )`;
}

export function outletInheritedFromClientHardwareClause(
  managerParamSql: string,
  clientAlias = "onec_clients",
  outletAlias = "outlet.elem",
): string {
  return `(
    ${clientHardwareGuidSql(clientAlias)} = lower(${managerParamSql}::text)
    AND (
      ${outletHardwareGuidSql(outletAlias)} IS NULL
      OR ${outletHardwareStateSql(outletAlias)} IN ('unassigned', 'invalid', 'not_provided')
    )
  )`;
}

/** Per-outlet visibility for manager sessions (list, card counts, catalog). */
export function managerOutletRowAccessibleClause(
  managerParamSql: string,
  storeAlias: string,
  clientAlias: string,
): string {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias);
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJson}) outlet(elem)
    WHERE lower(coalesce(outlet.elem->>'guidStore', '')) = lower(${storeAlias}.guid_store::text)
      AND (
        ${outletManagerGuidSql("outlet.elem")} = lower(${managerParamSql}::text)
        OR ${outletHardwareGuidSql("outlet.elem")} = lower(${managerParamSql}::text)
        OR ${outletInheritedFromClientManagerClause(managerParamSql, clientAlias, "outlet.elem")}
        OR ${outletInheritedFromClientHardwareClause(managerParamSql, clientAlias, "outlet.elem")}
      )
  )`;
}

export function outletRegionalGuidSql(outletAlias = "outlet"): string {
  return `NULLIF(BTRIM(lower(${outletAlias}->'managers'->'regionalManager'->>'guid')), '')`;
}

export function outletHardwareGuidSql(outletAlias = "outlet"): string {
  return `NULLIF(BTRIM(lower(${outletAlias}->'managers'->'hardwareManager'->>'guid')), '')`;
}

export function clientRegionalGuidSql(clientAlias = "onec_clients"): string {
  return `NULLIF(BTRIM(lower(${clientAlias}.extended_snapshot->'regionalManager'->>'guid')), '')`;
}

export function clientHardwareGuidSql(clientAlias = "onec_clients"): string {
  return `NULLIF(BTRIM(lower(${clientAlias}.extended_snapshot->'hardwareManager'->>'guid')), '')`;
}

/** Outlet row in extended snapshot assigned to ROP via outlet-level headOfSales. */
export function outletAssignedToRopClause(
  ropParamSql: string,
  outletAlias = "outlet.elem",
): string {
  return `${outletHeadOfSalesGuidSql(outletAlias)} = lower(${ropParamSql}::text)`;
}

/**
 * Outlet on a client-assigned ROP parent without a conflicting outlet-level ROP assignment.
 * Outlets explicitly assigned to another ROP stay excluded.
 */
export function outletInheritedFromClientRopClause(
  ropParamSql: string,
  clientAlias = "onec_clients",
  outletAlias = "outlet.elem",
): string {
  return `(
    ${clientAssignedToRopClause(ropParamSql, clientAlias)}
    AND (
      ${outletHeadOfSalesGuidSql(outletAlias)} IS NULL
      OR ${outletHeadOfSalesGuidSql(outletAlias)} = lower(${ropParamSql}::text)
    )
  )`;
}

export function outletStoreGuidSql(outletAlias = "outlet"): string {
  return `NULLIF(BTRIM(lower(${outletAlias}->>'guidStore')), '')`;
}

/** Clients assigned to a ROP employee via client-level headOfSales. */
export function clientAssignedToRopClause(ropParamSql: string, clientAlias = "onec_clients"): string {
  return `${clientHeadOfSalesGuidSql(clientAlias)} = lower(${ropParamSql}::text)`;
}

/** Client is not directly assigned to the ROP (NULL-safe; missing headOfSales counts as unassigned). */
export function clientNotAssignedToRopClause(ropParamSql: string, clientAlias = "onec_clients"): string {
  return `${clientHeadOfSalesGuidSql(clientAlias)} IS DISTINCT FROM lower(${ropParamSql}::text)`;
}

/** Outlets assigned to a ROP via outlet-level headOfSales in extended snapshot. */
export function outletAssignedToRopExistsClause(
  ropParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias)}) outlet(elem)
      WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower(${ropParamSql}::text)
    )
  `;
}

/** Portfolio under ROP: client headOfSales OR any outlet headOfSales matches. */
export function ropPortfolioClause(ropParamSql: string, clientAlias = "onec_clients"): string {
  return `(
    ${clientAssignedToRopClause(ropParamSql, clientAlias)}
    OR ${outletAssignedToRopExistsClause(ropParamSql, clientAlias)}
  )`;
}

/** Manager portfolio within a fixed ROP branch (client-level manager + outlet-level manager). */
export function managerInRopBranchClause(
  ropParamSql: string,
  managerParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `(
    (
      ${clientAssignedToRopClause(ropParamSql, clientAlias)}
      AND lower(${clientAlias}.guid_manager::text) = lower(${managerParamSql}::text)
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias)}) outlet(elem)
      WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower(${ropParamSql}::text)
        AND ${outletManagerGuidSql("outlet.elem")} = lower(${managerParamSql}::text)
    )
  )`;
}

/** Regional portfolio within ROP branch (client-level and outlet-level assignments). */
export function regionalInRopBranchClause(
  ropParamSql: string,
  regionalParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `(
    (
      ${clientAssignedToRopClause(ropParamSql, clientAlias)}
      AND ${clientRegionalGuidSql(clientAlias)} = lower(${regionalParamSql}::text)
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias)}) outlet(elem)
      WHERE ${outletHeadOfSalesGuidSql("outlet.elem")} = lower(${ropParamSql}::text)
        AND ${outletRegionalGuidSql("outlet.elem")} = lower(${regionalParamSql}::text)
    )
  )`;
}
