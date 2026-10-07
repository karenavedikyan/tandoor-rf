export type BonusTandoorClubPresentation = {
  value: string | null;
  hasSource: boolean;
  label: string;
};

function readFieldPresenceBonusProvided(additional: Record<string, unknown>): boolean {
  const fieldPresence = additional.fieldPresence;
  if (!fieldPresence || typeof fieldPresence !== "object" || Array.isArray(fieldPresence)) {
    return false;
  }
  return (fieldPresence as { bonusTandoorClub?: boolean }).bonusTandoorClub === true;
}

/** Legacy snapshots without fieldPresence treat bonus as not provided (hasSource=false). */
export function bonusTandoorClubFromAdditional(additional: unknown): {
  value: string | null;
  hasSource: boolean;
} {
  if (!additional || typeof additional !== "object" || Array.isArray(additional)) {
    return { value: null, hasSource: false };
  }
  const record = additional as Record<string, unknown>;
  if (!readFieldPresenceBonusProvided(record)) {
    return { value: null, hasSource: false };
  }
  const raw = record.bonusTandoorClub;
  if (typeof raw !== "string") {
    return { value: null, hasSource: true };
  }
  const trimmed = raw.trim();
  return { value: trimmed.length > 0 ? trimmed : null, hasSource: true };
}

export function bonusTandoorClubPresentationFromAdditional(additional: unknown): BonusTandoorClubPresentation {
  const base = bonusTandoorClubFromAdditional(additional);
  if (!base.hasSource) {
    return { ...base, label: "Не передано" };
  }
  if (base.value === null) {
    return { ...base, label: "Не заполнено" };
  }
  return { ...base, label: base.value };
}

export function bonusTandoorClubFilledSql(additionalExpr: string): string {
  return `(${additionalExpr}->'fieldPresence'->>'bonusTandoorClub') = 'true'
    AND NULLIF(BTRIM(${additionalExpr}->>'bonusTandoorClub'), '') IS NOT NULL`;
}

export function bonusTandoorClubEmptySql(additionalExpr: string): string {
  return `(${additionalExpr}->'fieldPresence'->>'bonusTandoorClub') = 'true'
    AND NULLIF(BTRIM(${additionalExpr}->>'bonusTandoorClub'), '') IS NULL`;
}

export function bonusTandoorClubSearchSql(additionalExpr: string, paramRef: string): string {
  return `(${additionalExpr}->'fieldPresence'->>'bonusTandoorClub') = 'true'
    AND NULLIF(BTRIM(${additionalExpr}->>'bonusTandoorClub'), '') ILIKE ${paramRef} ESCAPE '\\'`;
}
