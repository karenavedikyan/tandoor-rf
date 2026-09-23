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

function parsePositiveInt(value: unknown, fallback: number, max?: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
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

export function parseClientsListQuery(input: Record<string, unknown>): ParsedClientsListQuery {
  const rawQ = typeof input.q === "string" ? input.q.trim() : "";
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

  const phoneRaw = typeof input.phone === "string" ? input.phone.trim().toLowerCase() : "all";
  if (phoneRaw !== "all" && phoneRaw !== "yes" && phoneRaw !== "no") {
    return { ok: false, message: "Некорректный фильтр телефона." };
  }

  let managerId: string | undefined;
  if (input.manager !== undefined && input.manager !== null && input.manager !== "") {
    if (typeof input.manager !== "string" || !isValidUuidParam(input.manager)) {
      return { ok: false, message: "Некорректный фильтр менеджера." };
    }
    managerId = input.manager.trim().toLowerCase();
  }

  let holdingId: string | undefined;
  if (input.holding !== undefined && input.holding !== null && input.holding !== "") {
    if (typeof input.holding !== "string" || !isValidUuidParam(input.holding)) {
      return { ok: false, message: "Некорректный фильтр холдинга." };
    }
    holdingId = input.holding.trim().toLowerCase();
  }

  return {
    ok: true,
    query: {
      q: rawQ,
      managerId,
      holdingId,
      phone: phoneRaw as PhoneFilter,
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
