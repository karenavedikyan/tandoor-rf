/** Observed 1C category strings (September 2026 sample). */
export const ONEC_SALE_PRODUCT_CATEGORIES = [
  "Входные двери",
  "Межкомнатные двери",
  "Межкомнатные двери (погонаж)",
  "Фурнитура (ручки)",
  "Фурнитура (прочее)",
] as const;

export type OnecSaleProductCategory = (typeof ONEC_SALE_PRODUCT_CATEGORIES)[number];

export type SaleMacroGroup = "vh" | "mk" | "furniture" | "other";

const VH = new Set<string>(["Входные двери"]);
const MK = new Set<string>(["Межкомнатные двери", "Межкомнатные двери (погонаж)"]);
const FURNITURE = new Set<string>(["Фурнитура (ручки)", "Фурнитура (прочее)"]);

export function saleMacroGroup(productType: string): SaleMacroGroup {
  const t = productType.trim();
  if (VH.has(t)) {
    return "vh";
  }
  if (MK.has(t)) {
    return "mk";
  }
  if (FURNITURE.has(t)) {
    return "furniture";
  }
  return "other";
}

export function saleMacroGroupLabel(group: SaleMacroGroup): string {
  switch (group) {
    case "vh":
      return "ВХ";
    case "mk":
      return "МК";
    case "furniture":
      return "Фурнитура";
    default:
      return "Прочее";
  }
}
