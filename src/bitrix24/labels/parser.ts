import { parseLabelToken } from "./format";
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

const LINE_LABEL_REGEX = /^#LK_(H|J|T)_(\d{6})$/;

function stripMarkup(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/\[(\/)?(b|i|u|s|code|url|video|img|list|table|tr|td|th|quote)(=[^\]]*)?\]/gi, "")
    .trim();
}

export function extractLabelsFromDescription(description: string | null | undefined): ParsedDescriptionLabels {
  if (!description || description.trim().length === 0) {
    return { ok: true, labels: [], uniqueObjectKeys: [] };
  }

  const labels: Array<{ objectType: Bitrix24ObjectType; labelCode: string; token: string }> = [];
  const seenTokens = new Set<string>();
  const lines = description.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = stripMarkup(rawLine);
    if (!line) {
      continue;
    }
    if (LINE_LABEL_REGEX.test(line)) {
      if (seenTokens.has(line)) {
        continue;
      }
      seenTokens.add(line);
      const parsed = parseLabelToken(line);
      if (!parsed) {
        return { ok: false, reason: "invalid_token", labels };
      }
      labels.push({ ...parsed, token: line });
    } else if (/^#LK_/i.test(line)) {
      return { ok: false, reason: "invalid_token", labels };
    } else if (/(?:^|\s)#LK_(?:H|J|T)_\d{6}\s*$/.test(line)) {
      return { ok: false, reason: "invalid_token", labels };
    }
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
