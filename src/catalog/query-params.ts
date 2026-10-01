import { isValidUuidParam } from "../clients/uuid-param";
import { CATALOG_FILTER_DEFINITIONS } from "./filter-config";

export const CATALOG_MAX_FILTER_VALUE_LENGTH = 128;
export const CATALOG_MAX_FILTER_VALUES = 20;

export const CATALOG_DEFAULT_PAGE = 1;
export const CATALOG_DEFAULT_PAGE_SIZE = 20;
export const CATALOG_MAX_PAGE_SIZE = 50;
export const CATALOG_MAX_QUERY_LENGTH = 200;
export const CATALOG_MAX_SECTION_CODE_LENGTH = 128;
export const CATALOG_MAX_PRODUCT_CODE_LENGTH = 128;
export const CATALOG_MAX_OFFSET = 1_000_000;

export type ParsedCatalogSearchQuery = {
  q: string;
  sectionCode: string | null;
  propertyFilters: Record<string, string[]>;
  page: number;
  pageSize: number;
};

export type ParsedCatalogSearchResult =
  | { ok: true; value: ParsedCatalogSearchQuery }
  | { ok: false; message: string };

export type ParsedCatalogVersionIdResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

function rejectNonScalar(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}

function parseStrictPositiveInt(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (rejectNonScalar(raw)) return null;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function parseScalarString(raw: unknown, fallback: string): string | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (rejectNonScalar(raw) || typeof raw !== "string") return null;
  return raw.trim();
}

function validateOffset(page: number, pageSize: number): boolean {
  const offset = (page - 1) * pageSize;
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= CATALOG_MAX_OFFSET;
}

export function parseCatalogVersionId(raw: unknown): ParsedCatalogVersionIdResult {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (rejectNonScalar(raw) || typeof raw !== "string") {
    return { ok: false, message: "versionId must be a string." };
  }
  const trimmed = raw.trim();
  if (!isValidUuidParam(trimmed)) {
    return { ok: false, message: "versionId is invalid." };
  }
  return { ok: true, value: trimmed.toLowerCase() };
}

function parseFilterValues(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  const items = Array.isArray(raw) ? raw : [raw];
  if (!items.length) return [];
  const values: string[] = [];
  for (const item of items) {
    if (rejectNonScalar(item) || typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > CATALOG_MAX_FILTER_VALUE_LENGTH) return null;
    values.push(trimmed);
  }
  if (values.length > CATALOG_MAX_FILTER_VALUES) return null;
  return values;
}

export function parseCatalogPropertyFilters(
  input: Record<string, unknown>,
): { ok: true; value: Record<string, string[]> } | { ok: false; message: string } {
  const result: Record<string, string[]> = {};
  for (const definition of CATALOG_FILTER_DEFINITIONS) {
    const paramKey = `filter${definition.key.charAt(0).toUpperCase()}${definition.key.slice(1)}`;
    const raw = input[paramKey];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = parseFilterValues(raw);
    if (parsed === null) {
      return { ok: false, message: `Invalid filter values for ${definition.key}.` };
    }
    if (parsed.length) result[definition.key] = parsed;
  }
  for (const [key, raw] of Object.entries(input)) {
    if (!key.startsWith("filter") || key === "filter") continue;
    const suffix = key.slice("filter".length);
    if (!suffix) continue;
    const normalized =
      suffix.charAt(0).toLowerCase() + suffix.slice(1);
    if (CATALOG_FILTER_DEFINITIONS.some((item) => item.key === normalized)) continue;
    if (raw !== undefined && raw !== null && raw !== "") {
      return { ok: false, message: `Unknown catalog filter: ${normalized}.` };
    }
  }
  return { ok: true, value: result };
}

export function parseCatalogSearchQuery(input: {
  q?: unknown;
  section?: unknown;
  page?: unknown;
  pageSize?: unknown;
  filterBrand?: unknown;
  filterSeries?: unknown;
  filterColor?: unknown;
  filterCoating?: unknown;
  filterOpening?: unknown;
  filterArticle?: unknown;
  [key: string]: unknown;
}): ParsedCatalogSearchResult {
  const qRaw = parseScalarString(input.q, "");
  if (qRaw === null) {
    return { ok: false, message: "Search query must be a string." };
  }
  if (qRaw.length > CATALOG_MAX_QUERY_LENGTH) {
    return { ok: false, message: `Search query must not exceed ${CATALOG_MAX_QUERY_LENGTH} characters.` };
  }

  const sectionRaw = parseScalarString(input.section, "");
  if (sectionRaw === null) {
    return { ok: false, message: "Section filter must be a string." };
  }
  if (sectionRaw.length > CATALOG_MAX_SECTION_CODE_LENGTH) {
    return { ok: false, message: "Section filter is too long." };
  }

  const page = parseStrictPositiveInt(input.page, CATALOG_DEFAULT_PAGE);
  if (page === null) {
    return { ok: false, message: "Page must be a positive integer." };
  }

  const pageSize = parseStrictPositiveInt(input.pageSize, CATALOG_DEFAULT_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: "Page size must be a positive integer." };
  }
  if (pageSize > CATALOG_MAX_PAGE_SIZE) {
    return { ok: false, message: `Page size must not exceed ${CATALOG_MAX_PAGE_SIZE}.` };
  }
  if (!validateOffset(page, pageSize)) {
    return { ok: false, message: "Page offset is out of allowed range." };
  }

  const propertyFilters = parseCatalogPropertyFilters(input);
  if (!propertyFilters.ok) {
    return { ok: false, message: propertyFilters.message };
  }

  return {
    ok: true,
    value: {
      q: qRaw,
      sectionCode: sectionRaw || null,
      propertyFilters: propertyFilters.value,
      page,
      pageSize,
    },
  };
}

export function parseCatalogProductCode(raw: string | undefined): string | null {
  const code = (raw ?? "").trim();
  if (!code || code.length > CATALOG_MAX_PRODUCT_CODE_LENGTH) return null;
  return code;
}
