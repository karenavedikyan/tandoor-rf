import type { PoolClient } from "pg";
import { CATALOG_FILTER_DEFINITIONS, matchPropertyToFilter } from "./filter-config";
import type { CatalogFacetsResult } from "./types";
import type { ParsedCatalogSearchQuery } from "./query-params";
import {
  buildCatalogProductFilters,
  findUnavailablePropertyFilters,
  resolvePropertyFilterBindings,
} from "./search-filters";
import { escapeIlikeLiteral } from "./sql-utils";

export const CATALOG_FACET_VALUES_PAGE_SIZE = 100;
export const CATALOG_FACET_SEARCH_MAX_LENGTH = 64;
export const CATALOG_FACET_SEARCH_MAX_OFFSET = 10_000;

export class CatalogFilterUnavailableError extends Error {
  readonly filters: string[];

  constructor(filters: string[]) {
    super("Requested catalog filters are unavailable in the active snapshot.");
    this.name = "CatalogFilterUnavailableError";
    this.filters = filters;
  }
}

export async function assertCatalogPropertyFiltersAvailable(
  client: PoolClient,
  versionId: string,
  propertyFilters: Record<string, string[]>,
): Promise<void> {
  const unavailable = await findUnavailablePropertyFilters(client, versionId, propertyFilters);
  if (unavailable.length) {
    throw new CatalogFilterUnavailableError(unavailable);
  }
}

export async function loadCatalogFacets(
  client: PoolClient,
  versionId: string,
  query: ParsedCatalogSearchQuery,
): Promise<CatalogFacetsResult> {
  await assertCatalogPropertyFiltersAvailable(client, versionId, query.propertyFilters);

  const built = await buildCatalogProductFilters(client, versionId, query);
  const totalResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_catalog_products p WHERE ${built.whereClause}`,
    built.params,
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");

  const bindings = await resolvePropertyFilterBindings(client, versionId, query.propertyFilters);
  const availableFilters: Array<{ key: string; label: string }> = [];
  const facets: CatalogFacetsResult["facets"] = [];

  for (const definition of CATALOG_FILTER_DEFINITIONS) {
    const binding = bindings.find((item) => item.key === definition.key);
    const otherFilters = { ...query.propertyFilters };
    delete otherFilters[definition.key];
    const scopedQuery = { ...query, propertyFilters: otherFilters };
    const scopedBuilt = await buildCatalogProductFilters(client, versionId, scopedQuery);

    const propertyCodes = binding?.propertyCodes ?? lowercased(definition.propertyCodes);
    const propertyNames = binding?.propertyNames ?? lowercased(definition.propertyNames);
    const propertyMatchClause = `(LOWER(pf.property_code) = ANY($${scopedBuilt.params.length + 1}::text[]) OR LOWER(pf.property_name) = ANY($${scopedBuilt.params.length + 2}::text[]))`;

    const countParams = [...scopedBuilt.params, propertyCodes, propertyNames];

    const totalValuesResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(DISTINCT pf.property_value)::text AS count
        FROM onec_catalog_products p
        JOIN onec_catalog_product_properties pf
          ON pf.version_id = p.version_id AND pf.product_code = p.code
        WHERE ${scopedBuilt.whereClause}
          AND ${propertyMatchClause}
          AND pf.property_value <> ''
      `,
      countParams,
    );
    const totalValues = Number(totalValuesResult.rows[0]?.count ?? "0");
    if (!totalValues) continue;

    const valuesResult = await client.query<{ value: string; count: string }>(
      `
        SELECT pf.property_value AS value, COUNT(DISTINCT p.code)::text AS count
        FROM onec_catalog_products p
        JOIN onec_catalog_product_properties pf
          ON pf.version_id = p.version_id AND pf.product_code = p.code
        WHERE ${scopedBuilt.whereClause}
          AND ${propertyMatchClause}
          AND pf.property_value <> ''
        GROUP BY pf.property_value
        ORDER BY pf.property_value ASC
        LIMIT ${CATALOG_FACET_VALUES_PAGE_SIZE}
      `,
      countParams,
    );

    availableFilters.push({ key: definition.key, label: definition.label });
    const values = valuesResult.rows.map((row) => ({
      value: row.value,
      count: Number(row.count),
    }));
    const selectedValues = query.propertyFilters[definition.key] ?? [];
    for (const selected of selectedValues) {
      if (values.some((entry) => entry.value === selected)) continue;
      const selectedCount = await client.query<{ count: string }>(
        `
          SELECT COUNT(DISTINCT p.code)::text AS count
          FROM onec_catalog_products p
          JOIN onec_catalog_product_properties pf
            ON pf.version_id = p.version_id AND pf.product_code = p.code
          WHERE ${scopedBuilt.whereClause}
            AND ${propertyMatchClause}
            AND pf.property_value = $${countParams.length + 1}
        `,
        [...countParams, selected],
      );
      values.unshift({
        value: selected,
        count: Number(selectedCount.rows[0]?.count ?? "0"),
      });
    }
    facets.push({
      key: definition.key,
      label: definition.label,
      values,
      totalValues,
      valuesTruncated: totalValues > valuesResult.rows.length,
    });
  }

  return {
    versionId,
    total,
    facets,
    availableFilters,
  };
}

export async function loadCatalogFacetValues(
  client: PoolClient,
  versionId: string,
  query: ParsedCatalogSearchQuery,
  facetKey: string,
  searchQ: string,
  offset: number,
): Promise<{
  key: string;
  label: string;
  total: number;
  values: Array<{ value: string; count: number }>;
  offset: number;
  hasMore: boolean;
} | null> {
  await assertCatalogPropertyFiltersAvailable(client, versionId, query.propertyFilters);
  const definition = CATALOG_FILTER_DEFINITIONS.find((item) => item.key === facetKey);
  if (!definition) return null;

  const otherFilters = { ...query.propertyFilters };
  delete otherFilters[facetKey];
  const scopedQuery = { ...query, propertyFilters: otherFilters };
  const scopedBuilt = await buildCatalogProductFilters(client, versionId, scopedQuery);
  const bindings = await resolvePropertyFilterBindings(client, versionId, query.propertyFilters);
  const binding = bindings.find((item) => item.key === definition.key);
  const propertyCodes = binding?.propertyCodes ?? lowercased(definition.propertyCodes);
  const propertyNames = binding?.propertyNames ?? lowercased(definition.propertyNames);
  const propertyMatchClause = `(LOWER(pf.property_code) = ANY($${scopedBuilt.params.length + 1}::text[]) OR LOWER(pf.property_name) = ANY($${scopedBuilt.params.length + 2}::text[]))`;
  const countParams = [...scopedBuilt.params, propertyCodes, propertyNames];
  const searchClause = searchQ
    ? ` AND pf.property_value ILIKE $${countParams.length + 1}`
    : "";
  const searchParams = searchQ ? [`%${escapeIlikeLiteral(searchQ)}%`] : [];

  const totalResult = await client.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT pf.property_value)::text AS count
      FROM onec_catalog_products p
      JOIN onec_catalog_product_properties pf
        ON pf.version_id = p.version_id AND pf.product_code = p.code
      WHERE ${scopedBuilt.whereClause}
        AND ${propertyMatchClause}
        AND pf.property_value <> ''
        ${searchClause}
    `,
    [...countParams, ...searchParams],
  );
  const total = Number(totalResult.rows[0]?.count ?? "0");
  const valuesResult = await client.query<{ value: string; count: string }>(
    `
      SELECT pf.property_value AS value, COUNT(DISTINCT p.code)::text AS count
      FROM onec_catalog_products p
      JOIN onec_catalog_product_properties pf
        ON pf.version_id = p.version_id AND pf.product_code = p.code
      WHERE ${scopedBuilt.whereClause}
        AND ${propertyMatchClause}
        AND pf.property_value <> ''
        ${searchClause}
      GROUP BY pf.property_value
      ORDER BY pf.property_value ASC
      LIMIT ${CATALOG_FACET_VALUES_PAGE_SIZE}
      OFFSET ${offset}
    `,
    [...countParams, ...searchParams],
  );

  return {
    key: definition.key,
    label: definition.label,
    total,
    values: valuesResult.rows.map((row) => ({
      value: row.value,
      count: Number(row.count),
    })),
    offset,
    hasMore: offset + valuesResult.rows.length < total,
  };
}

function lowercased(values: string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

export function extractArticleFromProperties(
  properties: Array<{ property_code: string; property_name: string; property_value: string }>,
): string | null {
  for (const property of properties) {
    const matched = matchPropertyToFilter(property.property_code, property.property_name);
    if (matched?.key === "article" && property.property_value.trim()) {
      return property.property_value.trim();
    }
  }
  return null;
}

export function selectKeyProperties(
  properties: Array<{ property_code: string; property_name: string; property_value: string }>,
): Array<{ code: string; name: string; value: string }> {
  const selected: Array<{ code: string; name: string; value: string }> = [];
  for (const property of properties) {
    const matched = matchPropertyToFilter(property.property_code, property.property_name);
    if (!matched || matched.key === "article") continue;
    if (!property.property_value.trim()) continue;
    selected.push({
      code: property.property_code,
      name: property.property_name,
      value: property.property_value.trim(),
    });
    if (selected.length >= 5) break;
  }
  return selected;
}
