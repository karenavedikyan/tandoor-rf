import { LEGAL_A, LEGAL_B, buildSaleJsonBytes, buildSaleRecord } from "./legal-sales-fixtures";

export { LEGAL_A, LEGAL_B };

const ITEM_A = "d1000000-0000-4000-8000-000000000001";
const MONTH = "2026-09-01T00:00:00";
const CAT = "Входные двери";

export function buildSaleItemRecord(input: {
  legalGuid: string;
  type?: string;
  guidItem?: string;
  nameItem?: string;
  quantity?: number;
  income?: number;
  month?: string;
}) {
  const base = buildSaleRecord({
    legalGuid: input.legalGuid,
    type: input.type ?? CAT,
    month: input.month ?? MONTH,
    quantity: input.quantity ?? 1,
    income: input.income ?? 100,
  });
  const saleInfo = base.sale_info as Record<string, unknown>;
  saleInfo.guid_item = input.guidItem ?? ITEM_A;
  saleInfo.name_item = input.nameItem ?? "Synthetic SKU <b>xss</b>";
  return base;
}

export function buildReturnRecord(input: {
  legalGuid: string;
  type?: string;
  quantity?: number;
  income?: number;
  guidItem?: string;
  nameItem?: string;
  withItems?: boolean;
}) {
  const row: Record<string, unknown> = {
    month: MONTH,
    client_info: {
      name: "Synthetic",
      guid: input.legalGuid,
      inn: "1234567890",
      kpp: "123456789",
    },
    returne_info: {
      type: input.type ?? CAT,
      quantity: input.quantity ?? -2,
      income: input.income ?? -500,
    },
  };
  if (input.withItems) {
    const info = row.returne_info as Record<string, unknown>;
    info.guid_item = input.guidItem ?? ITEM_A;
    info.name_item = input.nameItem ?? "Return SKU";
  }
  return row;
}

export function buildAlignedSalesBundleBuffers() {
  const tiny = tinySalesBundleBuffers();
  return {
    saleAggregate: tiny.aggregate,
    saleItems: tiny.items,
    returnsAggregate: tiny.returns,
    returnItems: tiny.returnItems,
  };
}

/** Items income 999 vs aggregate 300 — parity must fail. */
export function buildMisalignedSalesItemsBuffer(): Buffer {
  return Buffer.from(
    buildSaleJsonBytes([
      buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 999 }),
    ]),
  );
}

export function tinySalesBundleBuffers() {
  const aggregate = buildSaleJsonBytes([
    buildSaleRecord({ legalGuid: LEGAL_A, type: CAT, quantity: 3, income: 300 }),
  ]);
  const items = buildSaleJsonBytes([
    buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 }),
    buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 2, income: 200 }),
  ]);
  const returns = buildSaleJsonBytes([
    buildReturnRecord({ legalGuid: LEGAL_B, quantity: -1, income: -50 }),
    buildReturnRecord({ legalGuid: LEGAL_B, quantity: -1, income: -50 }),
  ]).toString().replaceAll("sale_info", "returne_info");
  const returnItems = buildSaleJsonBytes([
    buildReturnRecord({ legalGuid: LEGAL_B, withItems: true, quantity: -2, income: -100 }),
  ])
    .toString()
    .replaceAll("sale_info", "returne_info");
  return {
    aggregate,
    items: Buffer.from(
      buildSaleJsonBytes([
        buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 }),
        buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 2, income: 200 }),
      ]),
    ),
    returns: Buffer.from(returns),
    returnItems: Buffer.from(returnItems),
  };
}
