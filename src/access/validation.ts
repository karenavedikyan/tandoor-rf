import { isValidUuidParam } from "../clients/uuid-param";

export type ParseError = { error: string };

export function parseStrictClientGuids(value: unknown): { guids: string[] } | ParseError {
  if (!Array.isArray(value)) {
    return { error: "clientGuids должен быть массивом UUID." };
  }
  if (value.length === 0) {
    return { error: "Нужен хотя бы один клиент." };
  }

  const seen = new Set<string>();
  const guids: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      return { error: "Каждый элемент clientGuids должен быть строкой UUID." };
    }
    const trimmed = item.trim().toLowerCase();
    if (!isValidUuidParam(trimmed)) {
      return { error: `Некорректный UUID клиента: «${item}».` };
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    guids.push(trimmed);
  }

  if (guids.length === 0) {
    return { error: "Нужен хотя бы один клиент." };
  }

  return { guids };
}

export function parseDelegationWindow(
  startsAt: unknown,
  endsAt: unknown,
): { startsAt: string; endsAt: string } | ParseError {
  if (typeof startsAt !== "string" || typeof endsAt !== "string") {
    return { error: "startsAt и endsAt обязательны." };
  }
  const startTrimmed = startsAt.trim();
  const endTrimmed = endsAt.trim();
  if (!startTrimmed || !endTrimmed) {
    return { error: "startsAt и endsAt не могут быть пустыми." };
  }

  const startDate = new Date(startTrimmed);
  const endDate = new Date(endTrimmed);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { error: "Некорректный формат даты startsAt или endsAt." };
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return { error: "endsAt должно быть позже startsAt." };
  }

  return {
    startsAt: startDate.toISOString(),
    endsAt: endDate.toISOString(),
  };
}
