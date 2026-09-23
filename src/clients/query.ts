import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH, MIN_PAGE } from "./constants";
import { escapeIlikePattern, normalizePhoneForSearch } from "./phone";
import { isValidUuidParam } from "./uuid-param";

export type PhoneFilter = "all" | "yes" | "no";

export type ClientsListQuery = {
  q: string;
  managerId?: string;
  holdingId?: string;
  phone: PhoneFilter;
  page: number;
  pageSize: number;
};

export type ParsedClientsListQuery =
  | { ok: true; query: ClientsListQuery }
  | { ok: false; message: string };

export type SqlFilter = {
  whereSql: string;
  params: unknown[];
};

function rejectNonScalar(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}

function parseScalarString(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    return null;
  }
  return value.trim();
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (rejectNonScalar(value)) {
    return null;
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return null;
  }
  const parsed = Number(str);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  if (max !== undefined && parsed > max) {
    return null;
  }
  if (parsed < MIN_PAGE) {
    return null;
  }
  return parsed;
}

function parseOptionalUuid(value: unknown, label: string): string | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (rejectNonScalar(value)) {
    return null;
  }
  if (typeof value !== "string" || !isValidUuidParam(value)) {
    return null;
  }
  return value.trim().toLowerCase();
}

export function parseClientsListQuery(input: Record<string, unknown>): ParsedClientsListQuery {
  if (rejectNonScalar(input.q)) {
    return { ok: false, message: "Некорректный параметр поиска." };
  }
  const rawQ = parseScalarString(input.q, "");
  if (rawQ === null) {
    return { ok: false, message: "Некорректный параметр поиска." };
  }
  if (rawQ.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: "Слишком длинный поисковый запрос." };
  }

  const page = parsePositiveInt(input.page, MIN_PAGE);
  if (page === null) {
    return { ok: false, message: "Некорректный номер страницы." };
  }

  const pageSize = parsePositiveInt(input.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: "Некорректный размер страницы." };
  }

  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    return { ok: false, message: "Некорректный номер страницы." };
  }

  if (rejectNonScalar(input.phone)) {
    return { ok: false, message: "Некорректный фильтр телефона." };
  }
  const phoneRaw = parseScalarString(input.phone, "all") ?? "all";
  if (phoneRaw === null) {
    return { ok: false, message: "Некорректный фильтр телефона." };
  }
  const phoneNormalized = phoneRaw.toLowerCase();
  if (phoneNormalized !== "all" && phoneNormalized !== "yes" && phoneNormalized !== "no") {
    return { ok: false, message: "Некорректный фильтр телефона." };
  }

  const managerId = parseOptionalUuid(input.manager, "менеджера");
  if (managerId === null) {
    return { ok: false, message: "Некорректный фильтр менеджера." };
  }

  const holdingId = parseOptionalUuid(input.holding, "холдинга");
  if (holdingId === null) {
    return { ok: false, message: "Некорректный фильтр холдинга." };
  }

  return {
    ok: true,
    query: {
      q: rawQ,
      managerId,
      holdingId,
      phone: phoneNormalized as PhoneFilter,
      page,
      pageSize,
    },
  };
}

function phonePresenceSql(mode: PhoneFilter): string {
  const hasPhone = `
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(onec_clients.telephone) AS phone_item(value)
      WHERE BTRIM(phone_item.value) <> ''
    )
  `;
  if (mode === "yes") {
    return hasPhone;
  }
  if (mode === "no") {
    return `NOT ${hasPhone}`;
  }
  return "TRUE";
}

export function buildClientsFilter(query: ClientsListQuery): SqlFilter {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.managerId) {
    params.push(query.managerId);
    clauses.push(`guid_manager = $${params.length}::uuid`);
  }

  if (query.holdingId) {
    params.push(query.holdingId);
    clauses.push(`guid_holding = $${params.length}::uuid`);
  }

  clauses.push(phonePresenceSql(query.phone));

  if (query.q.length > 0) {
    params.push(`%${escapeIlikePattern(query.q)}%`);
    const textParam = `$${params.length}`;
    const textClauses = [
      `name_client ILIKE ${textParam} ESCAPE '\\'`,
      `name_holding ILIKE ${textParam} ESCAPE '\\'`,
      `name_manager ILIKE ${textParam} ESCAPE '\\'`,
      `address ILIKE ${textParam} ESCAPE '\\'`,
    ];

    const normalizedPhone = normalizePhoneForSearch(query.q);
    if (normalizedPhone.length > 0 && /^\d+$/.test(normalizedPhone)) {
      params.push(`%${escapeIlikePattern(normalizedPhone)}%`);
      const phoneParam = `$${params.length}`;
      textClauses.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(onec_clients.telephone) AS phone_item(value)
          WHERE regexp_replace(phone_item.value, '[^0-9]', '', 'g')
            LIKE ${phoneParam}
        )
      `);
    }

    clauses.push(`(${textClauses.join(" OR ")})`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}
