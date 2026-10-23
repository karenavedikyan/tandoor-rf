export type ParsedLegalSaleLine = {
  sourceRowIndex: number;
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

export type ParsedLegalSaleItemLine = ParsedLegalSaleLine & {
  guidItem: string;
  nameItem: string;
};

export type ParsedLegalReturnLine = {
  sourceRowIndex: number;
  legalGuid: string;
  saleMonthYyyyMm: string;
  saleMonthStartIso: string;
  productType: string;
  quantity: string;
  income: string;
};

export type ParsedLegalReturnItemLine = ParsedLegalReturnLine & {
  guidItem: string;
  nameItem: string;
};

export type LegalSalesParseFailureCode =
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "FILE_TOO_LARGE"
  | "INVALID_RECORD"
  | "INVALID_FIELD"
  | "CLIENT_INFO_GUID_ID_CONFLICT"
  | "DUPLICATE_KEY_CONFLICT"
  | "MONTH_FIELD_CONFLICT";

export type LegalSalesRoster = {
  sourceSha256: string;
  lines: ParsedLegalSaleLine[];
  lineCount: number;
};

export type LegalSaleItemsRoster = {
  sourceSha256: string;
  lines: ParsedLegalSaleItemLine[];
  lineCount: number;
};

export type LegalReturnsRoster = {
  sourceSha256: string;
  lines: ParsedLegalReturnLine[];
  lineCount: number;
};

export type LegalReturnItemsRoster = {
  sourceSha256: string;
  lines: ParsedLegalReturnItemLine[];
  lineCount: number;
};
