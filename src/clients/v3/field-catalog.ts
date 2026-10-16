/** Read-only mapping for admin «Карта полей и источников» (no secrets, no raw PII). */

export type V3FieldCatalogRow = {
  id: string;
  prototypeLabel: string;
  jsonSource: string;
  v3Storage: string;
  listFilter: string | null;
  cardSection: string | null;
  notes: string | null;
};

export const V3_FIELD_CATALOG: readonly V3FieldCatalogRow[] = [
  {
    id: "name_client",
    prototypeLabel: "Название клиента",
    jsonSource: "name_client",
    v3Storage: "onec_v3_legal_entities.name_client",
    listFilter: "q (поиск)",
    cardSection: "Юрлицо",
    notes: null,
  },
  {
    id: "type_category",
    prototypeLabel: "Тип / категория",
    jsonSource: "type_category.{guid_type,name_type,guid_category,name_category}",
    v3Storage: "type_category JSONB",
    listFilter: "typeGuid / typeGuids, categoryGuid / categoryGuids",
    cardSection: "Юрлицо / ТТ / Холдинг",
    notes: "Multiselect до 8 значений (OR внутри поля)",
  },
  {
    id: "managers",
    prototypeLabel: "Ответственные",
    jsonSource: "guid_* / name_* managers",
    v3Storage: "managers JSONB",
    listFilter: "managerGuid, responsibleGuid+responsibleKind",
    cardSection: "Ответственные",
    notes: null,
  },
  {
    id: "discount",
    prototypeLabel: "Скидка",
    jsonSource: "Discount",
    v3Storage: "legal.discount",
    listFilter: null,
    cardSection: "Скидки и наценки",
    notes: "Read-only в карточке v3",
  },
  {
    id: "discount_amount",
    prototypeLabel: "Сумма скидки",
    jsonSource: "DiscountAmount",
    v3Storage: "legal.discount_amount",
    listFilter: null,
    cardSection: "Скидки и наценки",
    notes: null,
  },
  {
    id: "markups",
    prototypeLabel: "Наценки",
    jsonSource: "markups[]",
    v3Storage: "legal.markups JSONB",
    listFilter: null,
    cardSection: "Скидки и наценки",
    notes: null,
  },
  {
    id: "lpr_retail",
    prototypeLabel: "ЛПР",
    jsonSource: "LPR_information (retail)",
    v3Storage: "retail.lpr_information JSONB",
    listFilter: null,
    cardSection: "Торговая точка → ЛПР",
    notes: "На уровне юрлица в v3 не импортируется",
  },
  {
    id: "store_address",
    prototypeLabel: "Адрес ТТ",
    jsonSource: "retail_outlets[].address.store_address",
    v3Storage: "retail.address JSONB",
    listFilter: "q (retail)",
    cardSection: "Торговая точка",
    notes: null,
  },
  {
    id: "closed",
    prototypeLabel: "Статус ТТ",
    jsonSource: "closed",
    v3Storage: "onec_v3_retail_outlets.closed",
    listFilter: "closed=true|false",
    cardSection: "Торговая точка",
    notes: null,
  },
  {
    id: "inn",
    prototypeLabel: "ИНН",
    jsonSource: "inn (корень записи юрлица в all_clients.json)",
    v3Storage: "onec_v3_legal_entities.inn",
    listFilter: "inn (contains/eq/empty/filled)",
    cardSection: "Юрлицо → реквизиты",
    notes: "Строка, ведущие нули сохраняются; kpp — отдельное поле kpp, только карточка",
  },
] as const;

export function getV3FieldCatalog(): { items: V3FieldCatalogRow[]; updatedAt: string } {
  return {
    items: [...V3_FIELD_CATALOG],
    updatedAt: "2026-10-14",
  };
}
