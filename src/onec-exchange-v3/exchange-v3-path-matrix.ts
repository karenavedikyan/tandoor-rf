/**
 * Machine-readable v3 exchange path matrix (5 source files).
 * Each entry documents parser → storage → API → UI disposition for review/CI.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "./other-fields";

export type ExchangeV3PathDisposition = {
  file: "all_clients.json" | "all_holding.json" | "all_retail.json" | "all_employees.json" | "sale.json";
  path: string;
  parser: string;
  storage: string;
  api: string;
  ui: string;
  emptyState: string;
};

const LEGAL_ROOT: ExchangeV3PathDisposition[] = [
  {
    file: "all_clients.json",
    path: "guid_client",
    parser: "parseLegalRecord",
    storage: "onec_v3_legal_entities.guid_client",
    api: "detail.entity.guid",
    ui: "client-detail-v3 title",
    emptyState: "n/a",
  },
  {
    file: "all_clients.json",
    path: "name_client",
    parser: "parseLegalRecord",
    storage: "name_client",
    api: "detail.entity.name",
    ui: "title + data",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "inn",
    parser: "parseLegalRecord",
    storage: "inn",
    api: "detail.entity.inn",
    ui: "data + lazy legal preview",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "kpp",
    parser: "parseLegalRecord",
    storage: "kpp",
    api: "detail.entity.kpp",
    ui: "data + lazy legal preview",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "guid_holding",
    parser: "parseLegalRecord",
    storage: "guid_holding",
    api: "holdingLink",
    ui: "holding link",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "name_holding",
    parser: "parseLegalRecord",
    storage: "name_holding",
    api: "holdingLink.name",
    ui: "holding link label",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "type_category",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "TOP + category",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "type_category.guid_type",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "TOP column + card subtitle",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "type_category.name_type",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "TOP / type labels",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "type_category.guid_category",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "category filters",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "type_category.name_category",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "category column",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "managers",
    parser: "parseManagers",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "guid_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers.guidManager",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "name_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers.nameManager",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "guid_regional_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "name_regional_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "guid_hardware_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "name_hardware_manager",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "guid_head_of_the_sales_department",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "name_head_of_the_sales_department",
    parser: "parseManagers (legacy flat)",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "responsibility sections",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_clients.json",
    path: "address",
    parser: "parseLegalRecord",
    storage: "address",
    api: "detail.entity.address",
    ui: "overview + data",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "telephone",
    parser: "readStringArray",
    storage: "telephone JSONB",
    api: "detail.entity.telephone",
    ui: "data phones",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "telephone[]",
    parser: "readStringArray",
    storage: "telephone JSONB",
    api: "detail.entity.telephone",
    ui: "data phones",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "Discount",
    parser: "parseLegalRecord",
    storage: "discount",
    api: "detail.entity.discount",
    ui: "commercial block (0 shown)",
    emptyState: "show-zero",
  },
  {
    file: "all_clients.json",
    path: "DiscountAmount",
    parser: "parseLegalRecord",
    storage: "discount_amount",
    api: "detail.entity.discount_amount",
    ui: "commercial block",
    emptyState: "show-zero",
  },
  {
    file: "all_clients.json",
    path: "markups",
    parser: "parseLegalRecord",
    storage: "markups JSONB",
    api: "detail.entity.markups",
    ui: "commercial markups",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "markups[]",
    parser: "parseLegalRecord",
    storage: "markups JSONB",
    api: "detail.entity.markups",
    ui: "commercial markups",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "markups[].guid",
    parser: "parseLegalRecord",
    storage: "markups JSONB",
    api: "detail.entity.markups[].guid",
    ui: "commercial markups row",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "markups[].name",
    parser: "parseLegalRecord",
    storage: "markups JSONB",
    api: "detail.entity.markups[].name",
    ui: "commercial markups row",
    emptyState: "empty-1c",
  },
  {
    file: "all_clients.json",
    path: "markups[].percentage",
    parser: "parseLegalRecord",
    storage: "markups JSONB",
    api: "detail.entity.markups[].percentage",
    ui: "commercial markups row",
    emptyState: "show-zero",
  },
];

const OTHER_PARENT: ExchangeV3PathDisposition = {
  file: "all_clients.json",
  path: "other",
  parser: "pickSupportedOtherFields",
  storage: "other_fields JSONB",
  api: "presentLegalOtherFieldsForApi",
  ui: "data tab other groups",
  emptyState: "policy via other_field_states",
};

const OTHER_PATHS: ExchangeV3PathDisposition[] = V3_CLIENT_OTHER_INVENTORY_KEYS.map((key) => ({
  file: "all_clients.json" as const,
  path: `other.${key}`,
  parser: "pickSupportedOtherFields",
  storage: "other_fields JSONB (+ trusted complete marker server-side)",
  api: "presentLegalOtherFieldsForApi + other_field_states",
  ui: "client-detail-exchange-catalog groups / extras bucket",
  emptyState: "empty-1c | not_ingested | restricted via other_field_states",
}));

const HOLDING_ROOT: ExchangeV3PathDisposition[] = [
  {
    file: "all_holding.json",
    path: "guid_holding",
    parser: "parseHoldingRecord",
    storage: "onec_v3_holdings.guid_holding",
    api: "detail.entity.guid",
    ui: "holding title",
    emptyState: "n/a",
  },
  {
    file: "all_holding.json",
    path: "name_holding",
    parser: "parseHoldingRecord",
    storage: "name_holding",
    api: "detail.entity.name",
    ui: "holding title",
    emptyState: "empty-1c",
  },
  {
    file: "all_holding.json",
    path: "type_category",
    parser: "parseTypeCategory",
    storage: "type_category JSONB",
    api: "detail.entity.type_category",
    ui: "holding TOP (not child type)",
    emptyState: "empty-1c",
  },
  {
    file: "all_holding.json",
    path: "retail_chain",
    parser: "parseHoldingRecord",
    storage: "retail_chain",
    api: "detail.entity.retail_chain",
    ui: "holding data card",
    emptyState: "bool-empty",
  },
  {
    file: "all_holding.json",
    path: "holding_group",
    parser: "parseHoldingRecord",
    storage: "holding_group",
    api: "detail.entity.holding_group",
    ui: "holding data card",
    emptyState: "bool-empty",
  },
  {
    file: "all_holding.json",
    path: "managers",
    parser: "parseManagers",
    storage: "managers JSONB",
    api: "detail.entity.managers",
    ui: "holding responsibilities",
    emptyState: "not-assigned-1c",
  },
  {
    file: "all_holding.json",
    path: "legal_entities",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition",
    api: "composition.legalEntities",
    ui: "lazy legal expand",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "legal_entities[]",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition",
    api: "composition.legalEntities",
    ui: "lazy legal expand + link",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "legal_entities[].guid_retail",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition.member_guid",
    api: "composition.legalEntities.guid",
    ui: "lazy legal expand",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "legal_entities[].name_retail",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition.name_retail",
    api: "composition.legalEntities.name",
    ui: "lazy legal expand",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "retail_outlets",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition",
    api: "composition.retailOutlets",
    ui: "composition retail links",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "retail_outlets[]",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition",
    api: "composition.retailOutlets",
    ui: "composition retail links",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "retail_outlets[].guid_retail",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition.member_guid",
    api: "composition.retailOutlets.guid",
    ui: "composition retail links",
    emptyState: "empty-list",
  },
  {
    file: "all_holding.json",
    path: "retail_outlets[].name_retail",
    parser: "parseCompositionMembers",
    storage: "onec_v3_holding_composition.name_retail",
    api: "composition.retailOutlets.name",
    ui: "composition retail links",
    emptyState: "empty-list",
  },
];

const RETAIL_WILDCARD_PREFIXES = [
  "guid_store",
  "guid_holding",
  "warehouse",
  "closed",
  "type_category",
  "address",
  "information_loading",
  "managers",
  "contact_information",
  "LPR_information",
  "additional_information",
];

const RETAIL_PATHS: ExchangeV3PathDisposition[] = RETAIL_WILDCARD_PREFIXES.map((path) => ({
  file: "all_retail.json" as const,
  path,
  parser: "parseRetailRecord",
  storage: "onec_v3_retail_outlets column/JSONB",
  api: "getV3RetailDetail",
  ui: "retail card data tab groups",
  emptyState: "empty-1c",
}));

const EMPLOYEE_PATHS: ExchangeV3PathDisposition[] = [
  {
    file: "all_employees.json",
    path: "guid_manager",
    parser: "employee roster parse",
    storage: "wholesale employee roster tables",
    api: "via assignments only",
    ui: "manager names in responsibility blocks",
    emptyState: "policy",
  },
  {
    file: "all_employees.json",
    path: "email",
    parser: "employee roster parse",
    storage: "roster",
    api: "employee visibility policy",
    ui: "not in client card API",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "telephone",
    parser: "employee roster parse",
    storage: "roster",
    api: "employee visibility policy",
    ui: "not in client card API",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "name_manager",
    parser: "employee roster parse",
    storage: "roster",
    api: "assignment labels",
    ui: "responsibility blocks",
    emptyState: "policy",
  },
  {
    file: "all_employees.json",
    path: "guid_post",
    parser: "employee roster parse",
    storage: "roster",
    api: "not in client card",
    ui: "n/a",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "post",
    parser: "employee roster parse",
    storage: "roster",
    api: "ROP detection only",
    ui: "indirect via post title",
    emptyState: "policy",
  },
  {
    file: "all_employees.json",
    path: "date_of_assumption",
    parser: "employee roster parse",
    storage: "roster",
    api: "not in client card",
    ui: "n/a",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "guid_work_schedule",
    parser: "employee roster parse",
    storage: "roster",
    api: "not in client card",
    ui: "n/a",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "work_schedule",
    parser: "employee roster parse",
    storage: "roster",
    api: "not in client card",
    ui: "n/a",
    emptyState: "restricted",
  },
  {
    file: "all_employees.json",
    path: "guid_team",
    parser: "employee roster parse",
    storage: "roster/org",
    api: "team views only",
    ui: "n/a in v3 card",
    emptyState: "external",
  },
  {
    file: "all_employees.json",
    path: "name_team",
    parser: "employee roster parse",
    storage: "roster/org",
    api: "team views only",
    ui: "n/a in v3 card",
    emptyState: "external",
  },
  {
    file: "all_employees.json",
    path: "guid_team_leader",
    parser: "employee roster parse",
    storage: "roster/org",
    api: "team views only",
    ui: "n/a in v3 card",
    emptyState: "external",
  },
  {
    file: "all_employees.json",
    path: "name_team_leader",
    parser: "employee roster parse",
    storage: "roster/org",
    api: "team views only",
    ui: "n/a in v3 card",
    emptyState: "external",
  },
];

const SALE_PATHS: ExchangeV3PathDisposition[] = [
  {
    file: "sale.json",
    path: "month",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "legal sales endpoint",
    ui: "sales tab",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info.guid",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines.legal_guid",
    api: "sales lines filter",
    ui: "sales tab rows",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info.id",
    parser: "legal sales import (legacy id when guid absent)",
    storage: "onec_v3_legal_sales_lines.legal_guid",
    api: "sales lines filter",
    ui: "sales tab rows",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "sale_info",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines metrics JSONB",
    api: "sales line DTO",
    ui: "sales tab detail disclosure",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info",
    parser: "legal sales import",
    storage: "sales line join",
    api: "sales filter",
    ui: "sales tab",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info.name",
    parser: "legal sales import",
    storage: "denormalized in line",
    api: "not shown",
    ui: "n/a",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info.inn",
    parser: "legal sales import",
    storage: "denormalized in line",
    api: "not shown",
    ui: "n/a",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "client_info.kpp",
    parser: "legal sales import",
    storage: "denormalized in line",
    api: "not shown",
    ui: "n/a",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "sale_info.type",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].productType",
    ui: "sales table",
    emptyState: "not-imported",
  },
  {
    file: "sale.json",
    path: "sale_info.quantity",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].quantity",
    ui: "sales table",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.income",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].income",
    ui: "sales table",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.discounts",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales line detail",
    ui: "sales disclosure",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.discounts.manual_discount",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].manualDiscount",
    ui: "sales disclosure",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.discounts.automatic_discount",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].automaticDiscount",
    ui: "sales disclosure",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.discounts.total_discount",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].totalDiscount",
    ui: "sales disclosure",
    emptyState: "show-zero",
  },
  {
    file: "sale.json",
    path: "sale_info.cost_price",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].costPrice",
    ui: "sales disclosure (privileged)",
    emptyState: "restricted",
  },
  {
    file: "sale.json",
    path: "sale_info.additional_expenses",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].additionalExpenses",
    ui: "sales disclosure (privileged)",
    emptyState: "restricted",
  },
  {
    file: "sale.json",
    path: "sale_info.gross_profit",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].grossProfit",
    ui: "sales disclosure (privileged)",
    emptyState: "restricted",
  },
  {
    file: "sale.json",
    path: "sale_info.profitability",
    parser: "legal sales import",
    storage: "onec_v3_legal_sales_lines",
    api: "sales.lines[].profitability",
    ui: "sales disclosure (privileged)",
    emptyState: "restricted",
  },
];

function supplementalInventoryDispositions(): ExchangeV3PathDisposition[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data/client-card-v3-exchange-path-inventory.json"), "utf8"),
    ) as {
      files: Record<string, string[]>;
    };
    const templates: Record<string, Omit<ExchangeV3PathDisposition, "file" | "path">> = {
      "all_clients.json": {
        parser: "parseLegalRecord / pickSupportedOtherFields",
        storage: "onec_v3_legal_entities",
        api: "getV3LegalDetail + other_field_states",
        ui: "client-detail-v3 groups",
        emptyState: "policy via other_field_states",
      },
      "all_holding.json": {
        parser: "parseHoldingRecord / parseTypeCategory / parseManagers",
        storage: "onec_v3_holdings + composition",
        api: "holding detail + composition",
        ui: "holding card + lazy legal",
        emptyState: "varies",
      },
      "all_retail.json": {
        parser: "parseRetailRecord",
        storage: "onec_v3_retail_outlets",
        api: "getV3RetailDetail",
        ui: "retail card data groups",
        emptyState: "empty-1c",
      },
      "all_employees.json": {
        parser: "employee roster parse",
        storage: "wholesale roster tables",
        api: "assignments / policy",
        ui: "responsibility labels only",
        emptyState: "restricted",
      },
      "sale.json": {
        parser: "legal sales import",
        storage: "onec_v3_legal_sales_lines",
        api: "legal sales endpoints",
        ui: "sales tab",
        emptyState: "not-imported",
      },
    };
    const out: ExchangeV3PathDisposition[] = [];
    for (const [file, paths] of Object.entries(raw.files)) {
      const template = templates[file];
      if (!template) {
        continue;
      }
      for (const path of paths) {
        out.push({
          file: file as ExchangeV3PathDisposition["file"],
          path,
          ...template,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function dedupeMatrix(entries: ExchangeV3PathDisposition[]): ExchangeV3PathDisposition[] {
  const seen = new Set<string>();
  const out: ExchangeV3PathDisposition[] = [];
  for (const entry of entries) {
    const key = `${entry.file}:${entry.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export const EXCHANGE_V3_PATH_MATRIX: ExchangeV3PathDisposition[] = dedupeMatrix([
  ...LEGAL_ROOT,
  OTHER_PARENT,
  ...OTHER_PATHS,
  ...HOLDING_ROOT,
  ...RETAIL_PATHS,
  ...EMPLOYEE_PATHS,
  ...SALE_PATHS,
  ...supplementalInventoryDispositions(),
]);

const MATRIX_INDEX = new Map<string, ExchangeV3PathDisposition>();
for (const entry of EXCHANGE_V3_PATH_MATRIX) {
  MATRIX_INDEX.set(`${entry.file}:${entry.path}`, entry);
}

export function matchExchangeV3MatrixPath(
  file: ExchangeV3PathDisposition["file"],
  observedPath: string,
): ExchangeV3PathDisposition | null {
  const normalized = observedPath.replace(/\[\d+\]/g, "[]");
  return MATRIX_INDEX.get(`${file}:${normalized}`) ?? null;
}
