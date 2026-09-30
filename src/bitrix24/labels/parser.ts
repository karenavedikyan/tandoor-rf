import { BITRIX24_LABEL_TOKEN_REGEX, parseLabelToken } from "./format";
import type { Bitrix24ObjectType } from "./format";

export type ParsedDescriptionLabels =
  | {
      ok: true;
      labels: Array<{ objectType: Bitrix24ObjectType; labelCode: string; token: string }>;
      uniqueObjectKeys: string[];
    }
  | {
      ok: false;
      reason: "conflict" | "invalid_token";
      labels: Array<{ objectType: Bitrix24ObjectType; labelCode: string; token: string }>;
    };

function stripMarkup(description: string): string {
  return description
    .replace(/<[^>]*>/g, " ")
    .replace(/\[(\/)?(b|i|u|s|code|url|video|img|list|table|tr|td|th|quote)(=[^\]]*)?\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLabelsFromDescription(description: string | null | undefined): ParsedDescriptionLabels {
  if (!description || description.trim().length === 0) {
    return { ok: true, labels: [], uniqueObjectKeys: [] };
  }

  const plain = stripMarkup(description);
  const labels: Array<{ objectType: Bitrix24ObjectType; labelCode: string; token: string }> = [];
  const seenTokens = new Set<string>();

  for (const match of plain.matchAll(BITRIX24_LABEL_TOKEN_REGEX)) {
    const token = match[0]!;
    if (seenTokens.has(token)) {
      continue;
    }
    seenTokens.add(token);
    const parsed = parseLabelToken(token);
    if (!parsed) {
      return { ok: false, reason: "invalid_token", labels };
    }
    labels.push({ ...parsed, token });
  }

  const uniqueLabelCodes = new Set(labels.map((entry) => entry.labelCode));
  if (uniqueLabelCodes.size > 1) {
    return { ok: false, reason: "conflict", labels };
  }

  const uniqueObjectKeys = [...uniqueLabelCodes].map(
    (code) => labels.find((entry) => entry.labelCode === code)!.objectType + ":" + code,
  );

  return { ok: true, labels, uniqueObjectKeys };
}
