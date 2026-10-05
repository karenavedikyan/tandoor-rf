import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH, MIN_PAGE } from "./constants";
import { escapeIlikePattern, normalizePhoneForSearch } from "./phone";
import type { CompletenessReason } from "./org/completeness-reasons";
import { COMPLETENESS_REASONS } from "./org/completeness-reasons";
import type { ReviewDecision, ReviewState, UnassignedCategory } from "./review/constants";
import { REVIEW_DECISIONS, REVIEW_STATES, UNASSIGNED_CATEGORIES } from "./review/constants";
import { parseSortBy, parseSortDirection, type ClientSortField, type OutletSortField } from "./sort";
import { isValidUuidParam } from "./uuid-param";

export type PhoneFilter = "all" | "yes" | "no";
export type OutletsFilter = "all" | "yes" | "no";
export type OutletStatusFilter = "all" | "open" | "closed";
export type OutletWarehouseFilter = "all" | "yes" | "no" | "unknown";
export type ClientsViewMode = "all" | "teams" | "review" | "completeness";
export type ClientsEntityMode = "clients" | "outlets";

export type ClientsListQuery = {
  entity: ClientsEntityMode;
  view: ClientsViewMode;
  q: string;
  managerId?: string;
  holdingId?: string;
  phone: PhoneFilter;
  ropUserId?: string;
  /** 1C employee GUID for assignment-based ROP branch (distinct from ropUserId account id). */
  ropEmployeeGuid?: string;
  hardwareManagerId?: string;
  completenessReasons?: CompletenessReason[];
  completenessReasonMode?: "any" | "all";
  missingRop?: boolean;
  missingManager?: boolean;
  missingRegional?: boolean;
  unassignedCategory?: UnassignedCategory;
  reviewState?: ReviewState | "any";
  reviewDecision?: ReviewDecision | "any";
  hasOutlets: OutletsFilter;
  outletStatus: OutletStatusFilter;
  warehouseFilter: OutletWarehouseFilter;
  regionalManagerId?: string;
  tandoorClub?: string;
  sortBy: ClientSortField | OutletSortField;
  sortDir: "asc" | "desc";
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

  const entityRaw = parseScalarString(input.entity, "clients") ?? "clients";
  if (entityRaw !== "clients" && entityRaw !== "outlets") {
    return { ok: false, message: "Некорректный режим списка." };
  }

  const viewRaw = parseScalarString(input.view, "all") ?? "all";
  if (viewRaw !== "all" && viewRaw !== "teams" && viewRaw !== "review" && viewRaw !== "completeness") {
    return { ok: false, message: "Некорректный режим просмотра." };
  }

  const ropUserId = parseOptionalUuid(input.rop, "РОП");
  if (ropUserId === null) {
    return { ok: false, message: "Некорректный фильтр РОП." };
  }

  const ropEmployeeGuid = parseOptionalUuid(input.ropEmployee, "РОП (GUID сотрудника)");
  if (ropEmployeeGuid === null) {
    return { ok: false, message: "Некорректный фильтр РОП (GUID сотрудника)." };
  }

  if (ropUserId && ropEmployeeGuid) {
    return { ok: false, message: "Нельзя одновременно использовать rop и ropEmployee." };
  }

  const hardwareManagerId = parseOptionalUuid(input.hardwareManager, "менеджера по фурнитуре");
  if (hardwareManagerId === null) {
    return { ok: false, message: "Некорректный фильтр менеджера по фурнитуре." };
  }

  let completenessReasons: CompletenessReason[] | undefined;
  const rawCompletenessReasons = input.completenessReason ?? input.completenessReasons;
  if (rawCompletenessReasons !== undefined && rawCompletenessReasons !== null && rawCompletenessReasons !== "") {
    const values = Array.isArray(rawCompletenessReasons) ? rawCompletenessReasons : [rawCompletenessReasons];
    completenessReasons = [];
    for (const value of values) {
      if (rejectNonScalar(value)) {
        return { ok: false, message: "Некорректная причина неполноты." };
      }
      const raw = String(value).trim();
      if (!(COMPLETENESS_REASONS as readonly string[]).includes(raw)) {
        return { ok: false, message: "Некорректная причина неполноты." };
      }
      completenessReasons.push(raw as CompletenessReason);
    }
  }

  let completenessReasonMode: "any" | "all" | undefined;
  if (input.completenessReasonMode !== undefined && input.completenessReasonMode !== null && input.completenessReasonMode !== "") {
    if (rejectNonScalar(input.completenessReasonMode)) {
      return { ok: false, message: "Некорректный режим фильтра причин." };
    }
    const raw = String(input.completenessReasonMode).trim();
    if (raw !== "any" && raw !== "all") {
      return { ok: false, message: "Некорректный режим фильтра причин." };
    }
    completenessReasonMode = raw;
  }

  function parseOptionalBooleanFlag(value: unknown, label: string): boolean | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectNonScalar(value)) {
      return null;
    }
    const raw = String(value).trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") {
      return true;
    }
    if (raw === "0" || raw === "false" || raw === "no") {
      return false;
    }
    return null;
  }

  const missingRop = parseOptionalBooleanFlag(input.missingRop, "missingRop");
  if (missingRop === null) {
    return { ok: false, message: "Некорректный фильтр «не указан РОП»." };
  }
  const missingManager = parseOptionalBooleanFlag(input.missingManager, "missingManager");
  if (missingManager === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер»." };
  }
  const missingRegional = parseOptionalBooleanFlag(input.missingRegional, "missingRegional");
  if (missingRegional === null) {
    return { ok: false, message: "Некорректный фильтр «не указан региональный»." };
  }

  let unassignedCategory: UnassignedCategory | undefined;
  if (input.unassignedCategory !== undefined && input.unassignedCategory !== null && input.unassignedCategory !== "") {
    if (rejectNonScalar(input.unassignedCategory)) {
      return { ok: false, message: "Некорректная категория нераспределённого назначения." };
    }
    const raw = String(input.unassignedCategory).trim();
    if (!(UNASSIGNED_CATEGORIES as readonly string[]).includes(raw)) {
      return { ok: false, message: "Некорректная категория нераспределённого назначения." };
    }
    unassignedCategory = raw as UnassignedCategory;
  }

  let reviewState: ReviewState | "any" | undefined;
  if (input.reviewState !== undefined && input.reviewState !== null && input.reviewState !== "") {
    if (rejectNonScalar(input.reviewState)) {
      return { ok: false, message: "Некорректное состояние ревизии." };
    }
    const raw = String(input.reviewState).trim();
    if (raw !== "any" && !(REVIEW_STATES as readonly string[]).includes(raw)) {
      return { ok: false, message: "Некорректное состояние ревизии." };
    }
    reviewState = raw as ReviewState | "any";
  }

  let reviewDecision: ReviewDecision | "any" | undefined;
  if (input.reviewDecision !== undefined && input.reviewDecision !== null && input.reviewDecision !== "") {
    if (rejectNonScalar(input.reviewDecision)) {
      return { ok: false, message: "Некорректное решение ревизии." };
    }
    const raw = String(input.reviewDecision).trim();
    if (raw !== "any" && !(REVIEW_DECISIONS as readonly string[]).includes(raw)) {
      return { ok: false, message: "Некорректное решение ревизии." };
    }
    reviewDecision = raw as ReviewDecision | "any";
  }

  const outletsRaw = parseScalarString(input.hasOutlets, "all") ?? "all";
  if (outletsRaw !== "all" && outletsRaw !== "yes" && outletsRaw !== "no") {
    return { ok: false, message: "Некорректный фильтр торговых точек." };
  }

  const outletStatusRaw = parseScalarString(input.outletStatus, "all") ?? "all";
  if (outletStatusRaw !== "all" && outletStatusRaw !== "open" && outletStatusRaw !== "closed") {
    return { ok: false, message: "Некорректный фильтр статуса торговой точки." };
  }

  const warehouseRaw = parseScalarString(input.warehouse, "all") ?? "all";
  if (
    warehouseRaw !== "all" &&
    warehouseRaw !== "yes" &&
    warehouseRaw !== "no" &&
    warehouseRaw !== "unknown"
  ) {
    return { ok: false, message: "Некорректный фильтр склада." };
  }

  const regionalManagerId = parseOptionalUuid(input.regionalManager, "регионального менеджера");
  if (regionalManagerId === null) {
    return { ok: false, message: "Некорректный фильтр регионального менеджера." };
  }

  let tandoorClub: string | undefined;
  if (input.tandoorClub !== undefined && input.tandoorClub !== null && input.tandoorClub !== "") {
    if (rejectNonScalar(input.tandoorClub)) {
      return { ok: false, message: "Некорректный фильтр Tandoor Club." };
    }
    const raw = String(input.tandoorClub).trim();
    if (raw.length > MAX_SEARCH_LENGTH) {
      return { ok: false, message: "Слишком длинный фильтр Tandoor Club." };
    }
    tandoorClub = raw;
  }

  const sortDir = parseSortDirection(input.sortDir);
  if (sortDir === null) {
    return { ok: false, message: "Некорректное направление сортировки." };
  }
  const sortBy = parseSortBy(entityRaw as ClientsEntityMode, input.sortBy);
  if (sortBy === null) {
    return { ok: false, message: "Некорректное поле сортировки." };
  }

  return {
    ok: true,
    query: {
      entity: entityRaw as ClientsEntityMode,
      view: viewRaw as ClientsViewMode,
      q: rawQ,
      managerId,
      holdingId,
      phone: phoneNormalized as PhoneFilter,
      ropUserId,
      ropEmployeeGuid,
      hardwareManagerId,
      completenessReasons,
      completenessReasonMode: completenessReasonMode ?? "any",
      missingRop,
      missingManager,
      missingRegional,
      unassignedCategory,
      reviewState,
      reviewDecision,
      hasOutlets: outletsRaw as OutletsFilter,
      outletStatus: outletStatusRaw as OutletStatusFilter,
      warehouseFilter: warehouseRaw as OutletWarehouseFilter,
      regionalManagerId,
      tandoorClub,
      sortBy,
      sortDir,
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
    clauses.push(`onec_clients.guid_manager = $${params.length}::uuid`);
  }

  if (query.holdingId) {
    params.push(query.holdingId);
    clauses.push(`onec_clients.guid_holding = $${params.length}::uuid`);
  }

  clauses.push(phonePresenceSql(query.phone));

  if (query.entity === "clients" && query.q.length > 0) {
    params.push(`%${escapeIlikePattern(query.q)}%`);
    const textParam = `$${params.length}`;
    const textClauses = [
      `onec_clients.name_client ILIKE ${textParam} ESCAPE '\\'`,
      `onec_clients.name_holding ILIKE ${textParam} ESCAPE '\\'`,
      `onec_clients.name_manager ILIKE ${textParam} ESCAPE '\\'`,
      `onec_clients.address ILIKE ${textParam} ESCAPE '\\'`,
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

export function mergeFilterClauses(base: SqlFilter, extraClauses: string[], extraParams: unknown[]): SqlFilter {
  const params = [...base.params, ...extraParams];
  const baseClause = base.whereSql ? base.whereSql.replace(/^WHERE\s+/, "") : "";
  const clauses = [baseClause, ...extraClauses].filter((clause) => clause.length > 0);
  if (clauses.length === 0) {
    return { whereSql: "", params };
  }
  return {
    whereSql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}
