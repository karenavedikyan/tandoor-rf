import { MAX_SOURCE_BYTES } from "../onec-clients/constants";

/** Fixed FTP path segment (never change per owner contract). */
export const LEGAL_SALES_RELATIVE_PATH = "sale/sale.json";

export const MAX_LEGAL_SALES_BYTES = MAX_SOURCE_BYTES;

export function buildLegalSalesFilePath(basePath: string): string {
  const normalized = basePath.replace(/\/+$/, "");
  return `${normalized}/${LEGAL_SALES_RELATIVE_PATH}`;
}
