export type ParsedLegalSaleLine = {
  legalGuid: string;
  saleMonthYyyyMm: string;
  saleMonthStartIso: string;
  productType: string;
  quantity: string;
  income: string;
  manualDiscount: string;
  automaticDiscount: string;
  totalDiscount: string;
  costPrice: string;
  additionalExpenses: string;
  grossProfit: string;
  profitability: string;
};

export type LegalSalesParseFailureCode =
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "FILE_TOO_LARGE"
  | "INVALID_RECORD"
  | "INVALID_FIELD"
  | "DUPLICATE_KEY_CONFLICT"
  | "MONTH_FIELD_CONFLICT";

export type LegalSalesRoster = {
  sourceSha256: string;
  lines: ParsedLegalSaleLine[];
  lineCount: number;
};
