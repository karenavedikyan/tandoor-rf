export type ParsedTypeCategoryExchange = {
  guidType: string | null;
  nameType: string | null;
  guidCategory: string | null;
  nameCategory: string | null;
  fieldPresence: {
    guidType: boolean;
    nameType: boolean;
    guidCategory: boolean;
    nameCategory: boolean;
  };
};

export function createEmptyTypeCategoryExchange(): ParsedTypeCategoryExchange {
  return {
    guidType: null,
    nameType: null,
    guidCategory: null,
    nameCategory: null,
    fieldPresence: {
      guidType: false,
      nameType: false,
      guidCategory: false,
      nameCategory: false,
    },
  };
}

function readStringField(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  if (typeof value === "string") {
    return { ok: true, value };
  }
  return { ok: false };
}

/** Reads type_category object without inheriting from parent records. */
export function parseTypeCategoryExchangeFields(value: unknown): {
  typeCategory: ParsedTypeCategoryExchange;
  invalid: boolean;
} {
  const typeCategory = createEmptyTypeCategoryExchange();
  if (value === undefined) {
    return { typeCategory, invalid: false };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { typeCategory, invalid: true };
  }
  const raw = value as Record<string, unknown>;
  const guidType = readStringField(raw.guid_type);
  if (!guidType.ok) {
    return { typeCategory, invalid: true };
  }
  const nameType = readStringField(raw.name_type);
  if (!nameType.ok) {
    return { typeCategory, invalid: true };
  }
  const guidCategory = readStringField(raw.guid_category);
  if (!guidCategory.ok) {
    return { typeCategory, invalid: true };
  }
  const nameCategory = readStringField(raw.name_category);
  if (!nameCategory.ok) {
    return { typeCategory, invalid: true };
  }
  typeCategory.guidType = guidType.value;
  typeCategory.nameType = nameType.value;
  typeCategory.guidCategory = guidCategory.value;
  typeCategory.nameCategory = nameCategory.value;
  typeCategory.fieldPresence.guidType = "guid_type" in raw;
  typeCategory.fieldPresence.nameType = "name_type" in raw;
  typeCategory.fieldPresence.guidCategory = "guid_category" in raw;
  typeCategory.fieldPresence.nameCategory = "name_category" in raw;
  return { typeCategory, invalid: false };
}
