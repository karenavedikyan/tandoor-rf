import type { PoolClient } from "pg";
import { CATALOG_FILTER_DEFINITIONS, matchPropertyToFilter } from "./filter-config";
import type { CatalogFacetsResult } from "./types";
import type { ParsedCatalogSearchQuery } from "./query-params";
import { buildCatalogProductFilters, resolvePropertyFilterBindings } from "./search-filters";

export async function loadCatalogFacets(
  client: PoolClient,
  versionId: string,
  query: ParsedCatalogSearchQuery,
): Promise<CatalogFacetsResult> {
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

    const propertyMatchClause = binding
      ? `(pf.property_code = ANY($${scopedBuilt.params.length + 1}::text[]) OR pf.property_name = ANY($${scopedBuilt.params.length + 2}::text[]))`
      : `(pf.property_code = ANY($${scopedBuilt.params.length + 1}::text[]) OR pf.property_name = ANY($${scopedBuilt.params.length + 2}::text[]))`;

    const countParams = [
      ...scopedBuilt.params,
      binding?.propertyCodes ?? definition.propertyCodes,
      binding?.propertyNames ?? definition.propertyNames,
    ];

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
        LIMIT 100
      `,
      countParams,
    );

    if (!valuesResult.rows.length) continue;
    availableFilters.push({ key: definition.key, label: definition.label });
    facets.push({
      key: definition.key,
      label: definition.label,
      values: valuesResult.rows.map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
    });
  }

  return {
    versionId,
    total,
    facets,
    availableFilters,
  };
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
