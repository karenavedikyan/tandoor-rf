import type { ParsedOutletLpr } from "../onec-clients/extended-types";

export type LprScalarFieldKey = "name" | "post" | "phone" | "email" | "bonus" | "conditionsBonus";

export type LprFieldPresentation = {
  value: string | null;
  hasSource: boolean;
  label: string;
};

export type LprDateOfBirthPresentation = {
  value: string | null;
  hasSource: boolean;
  label: string;
  /** ISO YYYY-MM-DD when value is set */
  isoDate: string | null;
  preservedFromPreviousExport: boolean;
  ambiguousInSource: boolean;
  explicitEmptyInSource: boolean;
};

export type LprBlockPresentation = {
  name: LprFieldPresentation;
  post: LprFieldPresentation;
  phone: LprFieldPresentation;
  email: LprFieldPresentation;
  dateOfBirth: LprDateOfBirthPresentation;
  bonus: LprFieldPresentation;
  conditionsBonus: LprFieldPresentation;
};

const LPR_FIELD_PRESENCE_KEYS: Record<LprScalarFieldKey, LprScalarFieldKey> = {
  name: "name",
  post: "post",
  phone: "phone",
  email: "email",
  bonus: "bonus",
  conditionsBonus: "conditionsBonus",
};

/** Shared DTO + SQL rule: explicit fieldPresence when set; legacy snapshots infer from stored values/markers only. */
function readLprFieldPresence(lpr: ParsedOutletLpr | undefined, key: LprScalarFieldKey): boolean {
  if (!lpr) {
    return false;
  }
  const explicit = lpr.fieldPresence?.[key];
  if (explicit === true) {
    return true;
  }
  if (explicit === false) {
    return false;
  }
  const raw = lpr[key] ?? "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0;
}

function readDateOfBirthPresence(lpr: ParsedOutletLpr | undefined): boolean {
  if (!lpr) {
    return false;
  }
  const explicit = lpr.fieldPresence?.dateOfBirth;
  if (explicit === true) {
    return true;
  }
  if (explicit === false) {
    return false;
  }
  if (lpr.dateOfBirthExplicitEmpty) {
    return true;
  }
  if (lpr.dateOfBirthAmbiguous) {
    return true;
  }
  if (lpr.dateOfBirth != null && lpr.dateOfBirth.trim().length > 0) {
    return true;
  }
  return false;
}

function formatIsoDateRu(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function scalarPresentation(lpr: ParsedOutletLpr | undefined, key: LprScalarFieldKey): LprFieldPresentation {
  if (!lpr || !readLprFieldPresence(lpr, key)) {
    return { value: null, hasSource: false, label: "Не передано" };
  }
  const raw = lpr[key] ?? "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    return { value: null, hasSource: true, label: "Не заполнено" };
  }
  return { value: trimmed, hasSource: true, label: trimmed };
}

function dateOfBirthPresentation(lpr: ParsedOutletLpr | undefined): LprDateOfBirthPresentation {
  if (!lpr || !readDateOfBirthPresence(lpr)) {
    return {
      value: null,
      hasSource: false,
      label: "Не передано",
      isoDate: null,
      preservedFromPreviousExport: false,
      ambiguousInSource: false,
      explicitEmptyInSource: false,
    };
  }
  if (lpr.dateOfBirthExplicitEmpty) {
    return {
      value: null,
      hasSource: true,
      label: "Не заполнено",
      isoDate: null,
      preservedFromPreviousExport: false,
      ambiguousInSource: false,
      explicitEmptyInSource: true,
    };
  }
  if (lpr.dateOfBirthAmbiguous && lpr.dateOfBirth == null) {
    return {
      value: null,
      hasSource: true,
      label: "Неоднозначная дата в выгрузке",
      isoDate: null,
      preservedFromPreviousExport: false,
      ambiguousInSource: true,
      explicitEmptyInSource: false,
    };
  }
  if (lpr.dateOfBirth != null && lpr.dateOfBirth.trim().length > 0) {
    const iso = lpr.dateOfBirth.trim();
    const preserved = lpr.dateOfBirthConfirmedInCurrentExport === false;
    const label = preserved
      ? `${formatIsoDateRu(iso)} (сохранено из предыдущей выгрузки)`
      : formatIsoDateRu(iso);
    return {
      value: label,
      hasSource: true,
      label,
      isoDate: iso,
      preservedFromPreviousExport: preserved,
      ambiguousInSource: false,
      explicitEmptyInSource: false,
    };
  }
  return {
    value: null,
    hasSource: true,
    label: "Не заполнено",
    isoDate: null,
    preservedFromPreviousExport: false,
    ambiguousInSource: false,
    explicitEmptyInSource: false,
  };
}

export function lprPresentationFromParsed(lpr: ParsedOutletLpr | undefined): LprBlockPresentation {
  return {
    name: scalarPresentation(lpr, "name"),
    post: scalarPresentation(lpr, "post"),
    phone: scalarPresentation(lpr, "phone"),
    email: scalarPresentation(lpr, "email"),
    dateOfBirth: dateOfBirthPresentation(lpr),
    bonus: scalarPresentation(lpr, "bonus"),
    conditionsBonus: scalarPresentation(lpr, "conditionsBonus"),
  };
}

export function lprPresentationFromSnapshot(lprRaw: unknown): LprBlockPresentation {
  if (!lprRaw || typeof lprRaw !== "object" || Array.isArray(lprRaw)) {
    return lprPresentationFromParsed(undefined);
  }
  return lprPresentationFromParsed(lprRaw as ParsedOutletLpr);
}

function lprExprField(lprExpr: string, key: LprScalarFieldKey): string {
  return `${lprExpr}->>'${key}'`;
}

function lprFieldPresenceFlagExpr(lprExpr: string, key: LprScalarFieldKey | "dateOfBirth"): string {
  return `(${lprExpr}->'fieldPresence'->>'${key}')`;
}

function lprScalarPresenceExpr(lprExpr: string, key: LprScalarFieldKey): string {
  const flag = lprFieldPresenceFlagExpr(lprExpr, key);
  const field = lprExprField(lprExpr, key);
  return `(
    ${flag} = 'true'
    OR (
      ${flag} IS NULL
      AND NULLIF(BTRIM(${field}), '') IS NOT NULL
    )
  )`;
}

function lprDateOfBirthPresenceExpr(lprExpr: string): string {
  const flag = lprFieldPresenceFlagExpr(lprExpr, "dateOfBirth");
  return `(
    ${flag} = 'true'
    OR (
      ${flag} IS NULL
      AND (
        COALESCE((${lprExpr}->>'dateOfBirthExplicitEmpty')::boolean, false) = true
        OR COALESCE((${lprExpr}->>'dateOfBirthAmbiguous')::boolean, false) = true
        OR NULLIF(BTRIM(${lprExpr}->>'dateOfBirth'), '') IS NOT NULL
      )
    )
  )`;
}

export function lprScalarSearchSql(lprExpr: string, key: LprScalarFieldKey, paramRef: string): string {
  return `${lprScalarPresenceExpr(lprExpr, key)}
    AND NULLIF(BTRIM(${lprExprField(lprExpr, key)}), '') ILIKE ${paramRef} ESCAPE '\\'`;
}

export function lprScalarFilledSql(lprExpr: string, key: LprScalarFieldKey): string {
  return `${lprScalarPresenceExpr(lprExpr, key)}
    AND NULLIF(BTRIM(${lprExprField(lprExpr, key)}), '') IS NOT NULL`;
}

export function lprScalarEmptySql(lprExpr: string, key: LprScalarFieldKey): string {
  return `${lprScalarPresenceExpr(lprExpr, key)}
    AND NULLIF(BTRIM(${lprExprField(lprExpr, key)}), '') IS NULL`;
}

export function lprDateOfBirthFilledSql(lprExpr: string): string {
  return `${lprDateOfBirthPresenceExpr(lprExpr)}
    AND NULLIF(BTRIM(${lprExpr}->>'dateOfBirth'), '') IS NOT NULL
    AND COALESCE((${lprExpr}->>'dateOfBirthExplicitEmpty')::boolean, false) = false
    AND NOT (
      COALESCE((${lprExpr}->>'dateOfBirthAmbiguous')::boolean, false) = true
      AND NULLIF(BTRIM(${lprExpr}->>'dateOfBirth'), '') IS NULL
    )`;
}

export function lprDateOfBirthEmptySql(lprExpr: string): string {
  return `${lprDateOfBirthPresenceExpr(lprExpr)}
    AND (
      COALESCE((${lprExpr}->>'dateOfBirthExplicitEmpty')::boolean, false) = true
      OR (
        NULLIF(BTRIM(${lprExpr}->>'dateOfBirth'), '') IS NULL
        AND COALESCE((${lprExpr}->>'dateOfBirthAmbiguous')::boolean, false) = false
      )
      OR (
        COALESCE((${lprExpr}->>'dateOfBirthAmbiguous')::boolean, false) = true
        AND NULLIF(BTRIM(${lprExpr}->>'dateOfBirth'), '') IS NULL
      )
    )`;
}

export function lprDateOfBirthExactSql(lprExpr: string, paramRef: string): string {
  return `${lprDateOfBirthFilledSql(lprExpr)} AND BTRIM(${lprExpr}->>'dateOfBirth') = ${paramRef}`;
}

export function lprDateOfBirthFromSql(lprExpr: string, paramRef: string): string {
  return `${lprDateOfBirthFilledSql(lprExpr)} AND BTRIM(${lprExpr}->>'dateOfBirth') >= ${paramRef}`;
}

export function lprDateOfBirthToSql(lprExpr: string, paramRef: string): string {
  return `${lprDateOfBirthFilledSql(lprExpr)} AND BTRIM(${lprExpr}->>'dateOfBirth') <= ${paramRef}`;
}

export const LPR_FILLED_EMPTY_FIELD_MAP: Record<
  string,
  { filled: (expr: string) => string; empty: (expr: string) => string }
> = {
  lprName: {
    filled: (expr) => lprScalarFilledSql(expr, "name"),
    empty: (expr) => lprScalarEmptySql(expr, "name"),
  },
  lprPost: {
    filled: (expr) => lprScalarFilledSql(expr, "post"),
    empty: (expr) => lprScalarEmptySql(expr, "post"),
  },
  lprPhone: {
    filled: (expr) => lprScalarFilledSql(expr, "phone"),
    empty: (expr) => lprScalarEmptySql(expr, "phone"),
  },
  lprEmail: {
    filled: (expr) => lprScalarFilledSql(expr, "email"),
    empty: (expr) => lprScalarEmptySql(expr, "email"),
  },
  lprBonus: {
    filled: (expr) => lprScalarFilledSql(expr, "bonus"),
    empty: (expr) => lprScalarEmptySql(expr, "bonus"),
  },
  lprConditionsBonus: {
    filled: (expr) => lprScalarFilledSql(expr, "conditionsBonus"),
    empty: (expr) => lprScalarEmptySql(expr, "conditionsBonus"),
  },
  lprDateOfBirth: {
    filled: (expr) => lprDateOfBirthFilledSql(expr),
    empty: (expr) => lprDateOfBirthEmptySql(expr),
  },
};

export function lprFilledEmptySql(lprExpr: string, field: string, mode: "filled" | "empty"): string | null {
  const entry = LPR_FILLED_EMPTY_FIELD_MAP[field];
  if (!entry) {
    return null;
  }
  return mode === "filled" ? entry.filled(lprExpr) : entry.empty(lprExpr);
}

export const LPR_SCALAR_FILTER_KEYS = LPR_FIELD_PRESENCE_KEYS;

export type LprFilterParams = {
  lprNameContains?: string;
  lprPostContains?: string;
  lprPhoneContains?: string;
  lprEmailContains?: string;
  lprBonusContains?: string;
  lprConditionsBonusContains?: string;
  lprDateOfBirth?: string;
  lprDateOfBirthFrom?: string;
  lprDateOfBirthTo?: string;
};

export function appendLprFilterConditions(
  lprExpr: string,
  query: LprFilterParams,
  conditions: string[],
  params: unknown[],
  escapeIlikePattern: (value: string) => string,
): void {
  const textFilters: Array<[keyof LprFilterParams, LprScalarFieldKey]> = [
    ["lprNameContains", "name"],
    ["lprPostContains", "post"],
    ["lprPhoneContains", "phone"],
    ["lprEmailContains", "email"],
    ["lprBonusContains", "bonus"],
    ["lprConditionsBonusContains", "conditionsBonus"],
  ];
  for (const [paramKey, fieldKey] of textFilters) {
    const raw = query[paramKey];
    if (raw && raw.trim().length > 0) {
      params.push(`%${escapeIlikePattern(raw.trim())}%`);
      conditions.push(lprScalarSearchSql(lprExpr, fieldKey, `$${params.length}`));
    }
  }
  if (query.lprDateOfBirth && query.lprDateOfBirth.trim().length > 0) {
    params.push(query.lprDateOfBirth.trim());
    conditions.push(lprDateOfBirthExactSql(lprExpr, `$${params.length}`));
  }
  if (query.lprDateOfBirthFrom && query.lprDateOfBirthFrom.trim().length > 0) {
    params.push(query.lprDateOfBirthFrom.trim());
    conditions.push(lprDateOfBirthFromSql(lprExpr, `$${params.length}`));
  }
  if (query.lprDateOfBirthTo && query.lprDateOfBirthTo.trim().length > 0) {
    params.push(query.lprDateOfBirthTo.trim());
    conditions.push(lprDateOfBirthToSql(lprExpr, `$${params.length}`));
  }
}
