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
