import type { PoolClient } from "pg";
import { CATALOG_FILTER_DEFINITIONS, matchPropertyToFilter } from "./filter-config";
import { escapeIlikeLiteral } from "./sql-utils";
import type { ParsedCatalogSearchQuery } from "./query-params";
import { buildSectionTree, expandSectionCodes, type CatalogSectionRow } from "./section-tree";

export { buildSectionTree };

export type PropertyFilterBinding = {
  key: string;
  propertyCodes: string[];
  propertyNames: string[];
  values: string[];
};

export type BuiltCatalogFilters = {
  params: unknown[];
  whereClause: string;
  sectionCodes: string[] | null;
};

export async function loadSectionRows(
  client: PoolClient,
  versionId: string,
): Promise<CatalogSectionRow[]> {
  const result = await client.query<CatalogSectionRow>(
    `
      SELECT code, name, parent_code
      FROM onec_catalog_sections
      WHERE version_id = $1::uuid
    `,
    [versionId],
  );
  return result.rows;
}

export async function resolvePropertyFilterBindings(
  client: PoolClient,
  versionId: string,
  propertyFilters: Record<string, string[]>,
): Promise<PropertyFilterBinding[]> {
  if (!Object.keys(propertyFilters).length) return [];

  const rows = await client.query<{ property_code: string; property_name: string }>(
    `
      SELECT DISTINCT property_code, property_name
      FROM onec_catalog_product_properties
      WHERE version_id = $1::uuid
    `,
    [versionId],
  );

  const available = new Map<string, { codes: Set<string>; names: Set<string> }>();
  for (const definition of CATALOG_FILTER_DEFINITIONS) {
    available.set(definition.key, { codes: new Set(), names: new Set() });
  }
  for (const row of rows.rows) {
    const matched = matchPropertyToFilter(row.property_code, row.property_name);
    if (!matched) continue;
    available.get(matched.key)!.codes.add(row.property_code);
    available.get(matched.key)!.names.add(row.property_name);
  }

  const bindings: PropertyFilterBinding[] = [];
  for (const definition of CATALOG_FILTER_DEFINITIONS) {
    const values = propertyFilters[definition.key];
    if (!values?.length) continue;
    const discovered = available.get(definition.key)!;
    const codes = [...discovered.codes];
    const names = [...discovered.names];
    if (!codes.length && !names.length) continue;
    bindings.push({
      key: definition.key,
      propertyCodes: codes.length ? codes : definition.propertyCodes,
      propertyNames: names.length ? names : definition.propertyNames,
      values,
    });
  }
  return bindings;
}

export async function buildCatalogProductFilters(
  client: PoolClient,
  versionId: string,
  query: ParsedCatalogSearchQuery,
  sectionRows?: CatalogSectionRow[],
): Promise<BuiltCatalogFilters> {
  const params: unknown[] = [versionId];
  const filters: string[] = ["p.version_id = $1::uuid"];

  if (query.q) {
    params.push(`%${escapeIlikeLiteral(query.q)}%`);
    const qIndex = params.length;
    filters.push(
      `(p.name ILIKE $${qIndex} ESCAPE '\\' OR p.code ILIKE $${qIndex} ESCAPE '\\')`,
    );
  }

  let sectionCodes: string[] | null = null;
  if (query.sectionCode) {
    const rows = sectionRows ?? (await loadSectionRows(client, versionId));
    sectionCodes = expandSectionCodes(rows, query.sectionCode);
    params.push(sectionCodes);
    const sectionIndex = params.length;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM onec_catalog_product_sections ps
         WHERE ps.version_id = p.version_id
           AND ps.product_code = p.code
           AND ps.section_code = ANY($${sectionIndex}::text[])
       )`,
    );
  }

  const bindings = await resolvePropertyFilterBindings(client, versionId, query.propertyFilters);
  for (const binding of bindings) {
    params.push(binding.values);
    const valuesIndex = params.length;
    params.push(binding.propertyCodes);
    const codesIndex = params.length;
    params.push(binding.propertyNames);
    const namesIndex = params.length;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM onec_catalog_product_properties pf
         WHERE pf.version_id = p.version_id
           AND pf.product_code = p.code
           AND pf.property_value = ANY($${valuesIndex}::text[])
           AND (
             pf.property_code = ANY($${codesIndex}::text[])
             OR pf.property_name = ANY($${namesIndex}::text[])
           )
       )`,
    );
  }

  return {
    params,
    whereClause: filters.join(" AND "),
    sectionCodes,
  };
}
