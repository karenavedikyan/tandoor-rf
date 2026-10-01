import type { OnecFtpConfig } from "../onec-ftp/types";
import type { CatalogRelativeFile } from "./constants";

export function buildCatalogFilePath(basePath: string, relativeFile: CatalogRelativeFile): string {
  const normalizedBase = basePath.replace(/\/+$/, "");
  return `${normalizedBase}/${relativeFile}`;
}

export function buildAllCatalogRemotePaths(config: OnecFtpConfig): Record<CatalogRelativeFile, string> {
  const result = {} as Record<CatalogRelativeFile, string>;
  for (const relative of [
    "catalog/groups/data.xml",
    "catalog/section/data.xml",
    "catalog/storage/data.xml",
    "catalog/types_prices/data.xml",
    "catalog/products/data.xml",
    "catalog/prices/data.xml",
    "catalog/stock/data.xml",
    "catalog/stock_expected/data.xml",
  ] as const) {
    result[relative] = buildCatalogFilePath(config.basePath, relative);
  }
  return result;
}
