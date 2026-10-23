import { MAX_SOURCE_BYTES } from "../onec-clients/constants";

/** Fixed FTP path segments (never change per owner contract). */
export const LEGAL_SALES_RELATIVE_PATH = "sale/sale.json";
/** Item-level sales file; JSON nesting of guid_item/name_item pending verified sample. */
export const LEGAL_SALES_ITEMS_RELATIVE_PATH = "sale/sale(items).json";
export const LEGAL_RETURNS_RELATIVE_PATH = "sale/returne.json";
export const LEGAL_RETURNS_ITEMS_RELATIVE_PATH = "sale/returne(items).json";

export const MAX_LEGAL_SALES_BYTES = MAX_SOURCE_BYTES;

export function buildLegalSalesFilePath(basePath: string): string {
  const normalized = basePath.replace(/\/+$/, "");
  return `${normalized}/${LEGAL_SALES_RELATIVE_PATH}`;
}
