import type { Bitrix24ObjectType } from "../labels/format";

const LABELS: Record<Bitrix24ObjectType, string> = {
  holding: "Холдинг",
  legal_entity: "Юрлицо",
  outlet: "Торговая точка",
};

export function formatBoundObjectLabel(objectType: Bitrix24ObjectType | null): string | null {
  if (!objectType) {
    return null;
  }
  return LABELS[objectType] ?? objectType;
}
