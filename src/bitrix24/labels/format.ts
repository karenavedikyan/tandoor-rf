export type Bitrix24ObjectType = "holding" | "legal_entity" | "outlet";

const TYPE_PREFIX: Record<Bitrix24ObjectType, "H" | "J" | "T"> = {
  holding: "H",
  legal_entity: "J",
  outlet: "T",
};

const PREFIX_TYPE: Record<string, Bitrix24ObjectType> = {
  H: "holding",
  J: "legal_entity",
  T: "outlet",
};

export const BITRIX24_LABEL_TOKEN_REGEX = /#LK_(H|J|T)_(\d{6})\b/gi;

export function formatLabelCode(objectType: Bitrix24ObjectType, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw new Error("INVALID_LABEL_SEQUENCE");
  }
  const prefix = TYPE_PREFIX[objectType];
  return `LK_${prefix}_${String(sequence).padStart(6, "0")}`;
}

export function formatLabelToken(labelCode: string): string {
  return `#${labelCode}`;
}

export function parseLabelToken(token: string): {
  objectType: Bitrix24ObjectType;
  labelCode: string;
} | null {
  const match = token.trim().match(/^#LK_(H|J|T)_(\d{6})$/);
  if (!match) {
    return null;
  }
  const digits = match[2]!;
  if (digits === "000000") {
    return null;
  }
  const objectType = PREFIX_TYPE[match[1]!];
  if (!objectType) {
    return null;
  }
  const labelCode = `LK_${match[1]}_${digits}`;
  return { objectType, labelCode };
}

export function isValidLabelCode(labelCode: string): boolean {
  const parsed = parseLabelToken(`#${labelCode}`);
  return parsed !== null && parsed.labelCode === labelCode;
}
