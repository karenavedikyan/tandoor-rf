import type { AccessContext } from "../../access/types";

/** Field visibility for the standalone Sales section only (not legal card sales). */
export type SalesSectionFieldPolicy = {
  quantity: boolean;
  income: boolean;
  manualDiscount: boolean;
  automaticDiscount: boolean;
  totalDiscount: boolean;
  costPrice: boolean;
  additionalExpenses: boolean;
  grossProfit: boolean;
  profitability: boolean;
};

export function resolveSalesSectionFieldPolicy(context: AccessContext): SalesSectionFieldPolicy {
  if (context.role === "admin" || context.fullClientBase) {
    return {
      quantity: true,
      income: true,
      manualDiscount: true,
      automaticDiscount: true,
      totalDiscount: true,
      costPrice: true,
      additionalExpenses: true,
      grossProfit: true,
      profitability: true,
    };
  }
  if (context.role === "rop") {
    return {
      quantity: true,
      income: true,
      manualDiscount: true,
      automaticDiscount: true,
      totalDiscount: true,
      costPrice: false,
      additionalExpenses: true,
      grossProfit: true,
      profitability: true,
    };
  }
  return {
    quantity: true,
    income: true,
    manualDiscount: true,
    automaticDiscount: true,
    totalDiscount: true,
    costPrice: false,
    additionalExpenses: false,
    grossProfit: false,
    profitability: false,
  };
}
