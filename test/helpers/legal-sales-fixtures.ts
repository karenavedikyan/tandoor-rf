export const LEGAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const LEGAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function buildSaleRecord(input: {
  legalGuid: string;
  /** When set, emitted as client_info.guid (canonical). */
  clientInfoGuid?: string;
  /** When true, omit client_info.id (guid-only row). */
  guidOnly?: boolean;
  month?: string;
  type: string;
  quantity?: number | string;
  income?: number | string;
  manualDiscount?: number | string;
  automaticDiscount?: number | string;
  totalDiscount?: number | string;
  costPrice?: number | string;
  additionalExpenses?: number | string;
  grossProfit?: number | string;
  profitability?: number | string;
}) {
  const guid = input.clientInfoGuid ?? input.legalGuid;
  const client_info: Record<string, unknown> = {
    name: "Synthetic Legal",
    inn: "1234567890",
    kpp: "123456789",
  };
  if (input.guidOnly) {
    client_info.guid = guid;
  } else {
    client_info.guid = guid;
    client_info.id = input.legalGuid;
  }
  return {
    client_info,
    month: input.month ?? "2026-09-01T00:00:00",
    sale_info: {
      type: input.type,
      quantity: input.quantity ?? 1,
      income: input.income ?? 1000,
      discounts: {
        manual_discount: input.manualDiscount ?? 0,
        automatic_discount: input.automaticDiscount ?? 0,
        total_discount: input.totalDiscount ?? 0,
      },
      cost_price: input.costPrice ?? 500,
      additional_expenses: input.additionalExpenses ?? 0,
      gross_profit: input.grossProfit ?? 500,
      profitability: input.profitability ?? 50,
    },
  };
}

export function buildSaleJsonBytes(records: unknown[]): Buffer {
  return Buffer.from(JSON.stringify(records), "utf8");
}
