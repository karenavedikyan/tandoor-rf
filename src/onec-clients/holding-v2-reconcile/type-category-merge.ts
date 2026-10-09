import type { HoldingV2DesiredTypeCategoryPatch } from "./types";

export type StoredTypeCategory = {
  objectPresentInSource: boolean;
  fieldPresence: {
    guidType: boolean;
    nameType: boolean;
    guidCategory: boolean;
    nameCategory: boolean;
  };
  guidType: string | null;
  nameType: string | null;
  guidCategory: string | null;
  nameCategory: string | null;
};

export function validateTypeCategoryPatches(
  patches: HoldingV2DesiredTypeCategoryPatch[],
): "TYPE_CATEGORY_EXPLICIT_NULL" | null {
  for (const patch of patches) {
    if (patch.fieldPresence.guidType && patch.guidType === null) {
      return "TYPE_CATEGORY_EXPLICIT_NULL";
    }
    if (patch.fieldPresence.nameType && patch.nameType === null) {
      return "TYPE_CATEGORY_EXPLICIT_NULL";
    }
    if (patch.fieldPresence.guidCategory && patch.guidCategory === null) {
      return "TYPE_CATEGORY_EXPLICIT_NULL";
    }
    if (patch.fieldPresence.nameCategory && patch.nameCategory === null) {
      return "TYPE_CATEGORY_EXPLICIT_NULL";
    }
  }
  return null;
}

export function mergeTypeCategoryPatch(
  existing: StoredTypeCategory | undefined,
  patch: HoldingV2DesiredTypeCategoryPatch,
): StoredTypeCategory {
  const fieldPresence = {
    guidType: patch.fieldPresence.guidType || existing?.fieldPresence.guidType === true,
    nameType: patch.fieldPresence.nameType || existing?.fieldPresence.nameType === true,
    guidCategory: patch.fieldPresence.guidCategory || existing?.fieldPresence.guidCategory === true,
    nameCategory:
      patch.fieldPresence.nameCategory || existing?.fieldPresence.nameCategory === true,
  };
  return {
    objectPresentInSource: true,
    fieldPresence,
    guidType: patch.fieldPresence.guidType ? patch.guidType : (existing?.guidType ?? null),
    nameType: patch.fieldPresence.nameType ? patch.nameType : (existing?.nameType ?? null),
    guidCategory: patch.fieldPresence.guidCategory
      ? patch.guidCategory
      : (existing?.guidCategory ?? null),
    nameCategory: patch.fieldPresence.nameCategory
      ? patch.nameCategory
      : (existing?.nameCategory ?? null),
  };
}
