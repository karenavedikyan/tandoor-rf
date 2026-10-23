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

/** Whether 1C returne*.json actually carries a finance metric (only quantity/income today). */
export type SalesSectionFinanceAvailability = {
  manualDiscount: boolean;
  automaticDiscount: boolean;
  totalDiscount: boolean;
  costPrice: boolean;
  additionalExpenses: boolean;
  grossProfit: boolean;
  profitability: boolean;
};

export const SALES_SOURCE_FINANCE_AVAILABILITY: SalesSectionFinanceAvailability = {
  manualDiscount: true,
  automaticDiscount: true,
  totalDiscount: true,
  costPrice: true,
  additionalExpenses: true,
  grossProfit: true,
  profitability: true,
};

export const RETURNS_SOURCE_FINANCE_AVAILABILITY: SalesSectionFinanceAvailability = {
  manualDiscount: false,
  automaticDiscount: false,
  totalDiscount: false,
  costPrice: false,
  additionalExpenses: false,
  grossProfit: false,
  profitability: false,
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
