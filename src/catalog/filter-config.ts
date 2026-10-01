export type CatalogFilterDefinition = {
  key: string;
  label: string;
  propertyCodes: string[];
  propertyNames: string[];
  /** When true, exposed only if matching rows exist in active catalog snapshot. */
  discoverFromSnapshot: boolean;
};

/**
 * Explicit property mappings. Filters appear in UI/API only when
 * discoverFromSnapshot finds at least one matching property row.
 */
export const CATALOG_FILTER_DEFINITIONS: CatalogFilterDefinition[] = [
  {
    key: "brand",
    label: "Бренд",
    propertyCodes: ["brand", "brend", "Brand"],
    propertyNames: ["Бренд"],
    discoverFromSnapshot: true,
  },
  {
    key: "series",
    label: "Серия",
    propertyCodes: ["series", "seriya"],
    propertyNames: ["Серия"],
    discoverFromSnapshot: true,
  },
  {
    key: "color",
    label: "Цвет / декор",
    propertyCodes: ["color", "colour", "decor"],
    propertyNames: ["Цвет", "Декор", "Цвет/декор", "Цвет / декор"],
    discoverFromSnapshot: true,
  },
  {
    key: "coating",
    label: "Покрытие",
    propertyCodes: ["coating", "pokrytie"],
    propertyNames: ["Покрытие"],
    discoverFromSnapshot: true,
  },
  {
    key: "opening",
    label: "Тип открывания",
    propertyCodes: ["opening", "opening_type"],
    propertyNames: ["Тип открывания", "Открывание"],
    discoverFromSnapshot: true,
  },
  {
    key: "article",
    label: "Артикул",
    propertyCodes: ["article", "artikul", "sku"],
    propertyNames: ["Артикул"],
    discoverFromSnapshot: true,
  },
];

export function matchPropertyToFilter(
  propertyCode: string,
  propertyName: string,
): CatalogFilterDefinition | null {
  const code = propertyCode.trim();
  const name = propertyName.trim();
  for (const definition of CATALOG_FILTER_DEFINITIONS) {
    if (definition.propertyCodes.some((item) => item.toLowerCase() === code.toLowerCase())) {
      return definition;
    }
    if (definition.propertyNames.some((item) => item.toLowerCase() === name.toLowerCase())) {
      return definition;
    }
  }
  return null;
}
