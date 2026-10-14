import { isValidUuidParam } from "../uuid-param";

const MAX_MULTI_FILTER_GUIDS = 8;
/** Type/category tokens from 1C (not always UUID). */
const FILTER_TOKEN_RE = /^[\w.-]{1,64}$/;

function splitQueryList(value: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(...item.split(","));
      }
    }
  } else if (typeof value === "string") {
    parts.push(...value.split(","));
  }
  return parts;
}

export function parseMultiFilterTokenParam(value: unknown, max = MAX_MULTI_FILTER_GUIDS): string[] | undefined {
  const parts = splitQueryList(value);
  if (!parts.length && value !== undefined && value !== "") {
    return undefined;
  }
  const tokens: string[] = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (!FILTER_TOKEN_RE.test(trimmed)) {
      return undefined;
    }
    if (!tokens.includes(trimmed)) {
      tokens.push(trimmed);
    }
    if (tokens.length > max) {
      return undefined;
    }
  }
  return tokens.length ? tokens : undefined;
}

export function parseMultiGuidQueryParam(value: unknown, max = MAX_MULTI_FILTER_GUIDS): string[] | undefined {
  const parts = splitQueryList(value);
  if (!parts.length && value !== undefined && value !== "") {
    return undefined;
  }
  const guids: string[] = [];
  for (const raw of parts) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (!isValidUuidParam(trimmed)) {
      return undefined;
    }
    if (!guids.includes(trimmed)) {
      guids.push(trimmed);
    }
    if (guids.length > max) {
      return undefined;
    }
  }
  return guids.length ? guids : undefined;
}

export function parseSingleGuidQueryParam(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidUuidParam(raw) ? raw : null;
}
