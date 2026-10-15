/** Read-only SQL fragments for v3 list (no schema changes). */

/** Structured city on legal entities — only mapped other_fields keys, never free-text address. */
export const LEGAL_CITY_SQL = `NULLIF(TRIM(COALESCE(
  le.other_fields->>'Оптовик_КрайГород',
  le.other_fields->>'Оптовик_НаселенныйПункт',
  ''
)), '')`;

/** Business status if explicitly stored in other_fields; not type/category. */
export const LEGAL_STATUS_SQL = `NULLIF(TRIM(COALESCE(
  le.other_fields->>'Статус',
  le.other_fields->>'Status',
  ''
)), '')`;

export const LEGAL_ADDRESS_SQL = `NULLIF(TRIM(le.address), '')`;

export const RETAIL_CITY_SQL = `NULLIF(TRIM(ro.address->>'city'), '')`;

export const RETAIL_STATUS_LABEL_SQL = `(CASE WHEN ro.closed THEN 'Закрыта' ELSE 'Открыта' END)`;

export const LEGAL_CONTRACT_NUMBER_SQL = `NULLIF(TRIM(COALESCE(
  le.other_fields->>'Оптовик_ОсновнойДоговор',
  le.other_fields->>'Оптовик_ОсновноеСоглашение',
  ''
)), '')`;

export const LEGAL_DEFER_DAYS_SQL = `NULLIF(TRIM(le.other_fields->>'Оптовик_ДопустимоеЧислоДнейЗадолженности'), '')`;

export const LEGAL_CREDIT_LIMIT_SQL = `NULLIF(TRIM(le.other_fields->>'Оптовик_ДопустимаяСуммаЗадолженности'), '')`;

function legalCashPaymentTrueSql(alias: string): string {
  return `(
  (${alias}.other_fields->'Оптовик_Наличные') = 'true'::jsonb
  OR (${alias}.other_fields->'Оптовик_Наличные')::text = 'true'
  OR COALESCE(${alias}.other_fields->>'Оптовик_Наличные', '') IN ('true', 'True', '1', 'Да', 'да')
)`;
}

function legalCashPaymentFalseSql(alias: string): string {
  return `(
  (${alias}.other_fields->'Оптовик_Наличные') = 'false'::jsonb
  OR (${alias}.other_fields->'Оптовик_Наличные')::text = 'false'
  OR COALESCE(${alias}.other_fields->>'Оптовик_Наличные', '') IN ('false', 'False', '0', 'Нет', 'нет', 'Ложь', 'ложь')
)`;
}

/** Missing/null/empty/unknown → NULL (UI «Не передано»). */
export function legalPaymentTypeSql(alias = "le"): string {
  return `(CASE
  WHEN ${legalCashPaymentTrueSql(alias)} THEN 'Наличный расчёт'
  WHEN ${legalCashPaymentFalseSql(alias)} THEN 'Безналичный расчёт'
  ELSE NULL
END)`;
}

/** @deprecated Use legalPaymentTypeSql(alias) so member alias is correct in grouped queries. */
export const LEGAL_PAYMENT_TYPE_SQL = legalPaymentTypeSql("le");

export const LEGAL_MARKUP_PERCENTAGE_SQL = `NULLIF(TRIM((
  SELECT STRING_AGG(DISTINCT TRIM(elem->>'percentage'), '; ' ORDER BY TRIM(elem->>'percentage'))
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(le.markups) = 'array' THEN le.markups ELSE '[]'::jsonb END) elem
  WHERE NULLIF(TRIM(elem->>'percentage'), '') IS NOT NULL
)), '')`;
