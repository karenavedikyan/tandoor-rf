export const CATALOG_DEFAULT_PAGE = 1;
export const CATALOG_DEFAULT_PAGE_SIZE = 20;
export const CATALOG_MAX_PAGE_SIZE = 50;
export const CATALOG_MAX_QUERY_LENGTH = 200;
export const CATALOG_MAX_SECTION_CODE_LENGTH = 128;
export const CATALOG_MAX_PRODUCT_CODE_LENGTH = 128;

export type ParsedCatalogSearchQuery = {
  q: string;
  sectionCode: string | null;
  page: number;
  pageSize: number;
};

export type ParsedCatalogSearchResult =
  | { ok: true; value: ParsedCatalogSearchQuery }
  | { ok: false; message: string };

function parsePositiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export function parseCatalogSearchQuery(input: {
  q?: string;
  section?: string;
  page?: string;
  pageSize?: string;
}): ParsedCatalogSearchResult {
  const q = (input.q ?? "").trim().slice(0, CATALOG_MAX_QUERY_LENGTH);
  const sectionRaw = (input.section ?? "").trim();
  if (sectionRaw.length > CATALOG_MAX_SECTION_CODE_LENGTH) {
    return { ok: false, message: "Section filter is too long." };
  }
  const page = parsePositiveInt(input.page, CATALOG_DEFAULT_PAGE);
  if (page === null) {
    return { ok: false, message: "Page must be a positive integer." };
  }
  const pageSize = parsePositiveInt(input.pageSize, CATALOG_DEFAULT_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: "Page size must be a positive integer." };
  }
  if (pageSize > CATALOG_MAX_PAGE_SIZE) {
    return { ok: false, message: `Page size must not exceed ${CATALOG_MAX_PAGE_SIZE}.` };
  }
  return {
    ok: true,
    value: {
      q,
      sectionCode: sectionRaw || null,
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
