/**
 * Parses `#орк` claim summary markers in Bitrix24 task DESCRIPTION.
 *
 * Token rules:
 * - Exact tag `#орк` (case-insensitive Cyrillic).
 * - Must be a standalone hashtag: preceded by start-of-string or whitespace;
 *   not followed by a Unicode letter, digit, or underscore (so `#оркестр` is rejected).
 * - Exactly one tag per description; zero or multiple tags → no publication.
 * - Summary text is everything after the tag (optional horizontal whitespace skipped) to EOF.
 * - Line breaks inside the summary are preserved.
 * - `[ЛК]` blocks are not used; only DESCRIPTION is parsed.
 */

export const ORK_SUMMARY_MAX_LENGTH = 8000;

export type ParsedOrkSummary =
  | { ok: true; briefText: string }
  | {
      ok: false;
      reason: "missing_tag" | "multiple_tags" | "empty_summary" | "too_long" | "unsafe_content";
    };

const ORK_TAG_PATTERN = /(?:^|[\s\u00A0])#орк(?![\p{L}\p{N}_])/giu;

function normalizeDescription(description: string): string {
  return description
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n");
}

function stripUnsafeMarkup(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[(\/)?(b|i|u|s|code|url|video|img|list|table|tr|td|th|quote)(=[^\]]*)?\]/gi, "");
}

function findOrkTagMatches(normalized: string): RegExpMatchArray[] {
  return [...normalized.matchAll(ORK_TAG_PATTERN)];
}

function extractSummaryAfterTag(normalized: string, match: RegExpMatchArray): string {
  const tagEndIndex = (match.index ?? 0) + match[0].length;
  const tail = normalized.slice(tagEndIndex);
  return tail.replace(/^[ \t]+/, "");
}

export function parseOrkSummaryFromDescription(
  description: string | null | undefined,
): ParsedOrkSummary {
  if (!description || description.trim().length === 0) {
    return { ok: false, reason: "missing_tag" };
  }

  const normalized = normalizeDescription(description);
  const matches = findOrkTagMatches(normalized);
  if (matches.length === 0) {
    return { ok: false, reason: "missing_tag" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "multiple_tags" };
  }

  const rawSummary = extractSummaryAfterTag(normalized, matches[0]!);
  if (/javascript:/i.test(rawSummary)) {
    return { ok: false, reason: "unsafe_content" };
  }
  const briefText = stripUnsafeMarkup(rawSummary).replace(/\u0000/g, "");
  const trimmed = briefText.replace(/[ \t\u00A0]+$/g, "").replace(/^[ \t\u00A0]+/g, "");
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty_summary" };
  }
  if (trimmed.length > ORK_SUMMARY_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, briefText: trimmed };
}
