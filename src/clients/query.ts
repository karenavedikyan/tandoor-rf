import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH, MIN_PAGE } from "./constants";
import { escapeIlikePattern, normalizePhoneForSearch } from "./phone";
import type { CompletenessReason } from "./org/completeness-reasons";
import { COMPLETENESS_REASONS } from "./org/completeness-reasons";
import {
  parseBranchPortfolio,
  parseResponsibleAssignmentKind,
} from "./org/teams-list-filters";
import { ONEC_TEAM_UNDEFINED_KEY } from "./org/onec-teams-repository";
import type { ReviewDecision, ReviewState, UnassignedCategory } from "./review/constants";
import { REVIEW_DECISIONS, REVIEW_STATES, UNASSIGNED_CATEGORIES } from "./review/constants";
import { resolveAssignmentParams } from "./assignment-query-params";
import {
  parseAssignmentPresenceMode,
  parseUuidListParam,
  type AssignmentPresenceMode,
} from "./assignment-filter-modes";
import { validateFilledEmptyFields } from "./field-filter-registry";
import { parseSortBy, parseSortDirection, type ClientSortField, type OutletSortField } from "./sort";
import { isValidUuidParam } from "./uuid-param";

export type PhoneFilter = "all" | "yes" | "no";
export type OutletsFilter = "all" | "yes" | "no";
export type OutletStatusFilter = "all" | "open" | "closed";
export type OutletWarehouseFilter = "all" | "yes" | "no" | "unknown";
export type ClientsViewMode = "all" | "teams" | "review" | "completeness";
export type ClientsEntityMode = "clients" | "outlets";

export type LoadingScheduleFilter = "all" | "yes" | "no";

export type ClientsListQuery = {
  entity: ClientsEntityMode;
  view: ClientsViewMode;
  q: string;
  /** Legacy alias for clientManagerId (teams/org compat). */
  managerId?: string;
  managerIds?: string[];
  clientManagerId?: string;
  clientManagerIds?: string[];
  outletManagerId?: string;
  outletManagerIds?: string[];
  holdingId?: string;
  phone: PhoneFilter;
  ropUserId?: string;
  /** Legacy / org-teams ROP employee GUID. */
  ropEmployeeGuid?: string;
  clientRopEmployeeGuid?: string;
  outletRopEmployeeGuid?: string;
  branchPortfolio?: "clients" | "outlets";
  /** 1C team portfolio filter (UUID or ONEC_TEAM_UNDEFINED_KEY). */
  onecTeamGuid?: string;
  teamSource?: "onec";
  responsibleKind?: "manager" | "regional" | "hardware";
  /** Legacy aliases — prefer client* / outlet* fields. */
  hardwareManagerId?: string;
  hardwareManagerIds?: string[];
  regionalManagerId?: string;
  regionalManagerIds?: string[];
  clientRegionalManagerId?: string;
  clientRegionalManagerIds?: string[];
  outletRegionalManagerId?: string;
  outletRegionalManagerIds?: string[];
  clientHardwareManagerId?: string;
  clientHardwareManagerIds?: string[];
  outletHardwareManagerId?: string;
  outletHardwareManagerIds?: string[];
  clientManagerMode?: AssignmentPresenceMode;
  outletManagerMode?: AssignmentPresenceMode;
  clientRegionalManagerMode?: AssignmentPresenceMode;
  outletRegionalManagerMode?: AssignmentPresenceMode;
  clientHardwareManagerMode?: AssignmentPresenceMode;
  outletHardwareManagerMode?: AssignmentPresenceMode;
  clientRopEmployeeMode?: AssignmentPresenceMode;
  outletRopEmployeeMode?: AssignmentPresenceMode;
  /** @deprecated use clientRopEmployeeMode / outletRopEmployeeMode */
  regionalManagerMode?: AssignmentPresenceMode;
  hardwareManagerMode?: AssignmentPresenceMode;
  ropEmployeeMode?: AssignmentPresenceMode;
  completenessReasons?: CompletenessReason[];
  completenessReasonMode?: "any" | "all";
  missingRop?: boolean;
  missingManager?: boolean;
  missingRegional?: boolean;
  missingHardware?: boolean;
  missingClientManager?: boolean;
  missingOutletManager?: boolean;
  missingClientRegional?: boolean;
  missingOutletRegional?: boolean;
  missingClientHardware?: boolean;
  missingOutletHardware?: boolean;
  missingClientRop?: boolean;
  missingOutletRop?: boolean;
  unassignedCategory?: UnassignedCategory;
  reviewState?: ReviewState | "any";
  reviewDecision?: ReviewDecision | "any";
  hasOutlets: OutletsFilter;
  outletStatus: OutletStatusFilter;
  warehouseFilter: OutletWarehouseFilter;
  tandoorClub?: string;
  routeDirection?: string;
  storeAddressContains?: string;
  storePhoneContains?: string;
  accountantPhoneContains?: string;
  accountantEmailContains?: string;
  loadingTime?: string;
  loadingSchedule?: LoadingScheduleFilter;
  filled?: string;
  empty?: string;
  discountProgram?: string;
  discountAmountMin?: number;
  discountAmountMax?: number;
  markupName?: string;
  markupPercentage?: number;
  bonusTandoorClub?: string;
  lprNameContains?: string;
  lprPostContains?: string;
  lprPhoneContains?: string;
  lprEmailContains?: string;
  lprBonusContains?: string;
  lprConditionsBonusContains?: string;
  lprDateOfBirth?: string;
  lprDateOfBirthFrom?: string;
  lprDateOfBirthTo?: string;
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

  const entityRaw = parseScalarString(input.entity, "clients") ?? "clients";
  if (entityRaw !== "clients" && entityRaw !== "outlets") {
    return { ok: false, message: "Некорректный режим списка." };
  }

  const assignmentResolved = resolveAssignmentParams(input, entityRaw as ClientsEntityMode);
  if (!assignmentResolved.ok) {
    return { ok: false, message: assignmentResolved.message };
  }
  const assignment = assignmentResolved.params;

  const holdingId = parseOptionalUuid(input.holding, "холдинга");
  if (holdingId === null) {
    return { ok: false, message: "Некорректный фильтр холдинга." };
  }

  const viewRaw = parseScalarString(input.view, "all") ?? "all";
  if (viewRaw !== "all" && viewRaw !== "teams" && viewRaw !== "review" && viewRaw !== "completeness") {
    return { ok: false, message: "Некорректный режим просмотра." };
  }

  const ropUserId = parseOptionalUuid(input.rop, "РОП");
  if (ropUserId === null) {
    return { ok: false, message: "Некорректный фильтр РОП." };
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

  const ropEmployeeGuid =
    assignment.ropEmployeeGuid ??
    (entityRaw === "clients" ? assignment.clientRopEmployeeGuid : assignment.outletRopEmployeeGuid);

  if (ropUserId && ropEmployeeGuid) {
    return { ok: false, message: "Нельзя одновременно использовать rop и ropEmployee." };
  }

  function parseOptionalSearchField(value: unknown, _label: string): string | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectNonScalar(value)) {
      return null;
    }
    const raw = String(value).trim();
    if (raw.length > MAX_SEARCH_LENGTH) {
      return null;
    }
    return raw;
  }

  function parseOptionalIsoDateField(value: unknown, _label: string): string | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectNonScalar(value)) {
      return null;
    }
    const raw = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return null;
    }
    return raw;
  }

  function parseOptionalStrictNumber(value: unknown): number | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectNonScalar(value)) {
      return null;
    }
    const str = String(value).trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(str)) {
      return null;
    }
    const parsed = Number(str);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
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

  const routeDirection = parseOptionalSearchField(input.routeDirection, "routeDirection");
  if (routeDirection === null) {
    return { ok: false, message: "Некорректный фильтр направления маршрута." };
  }
  const storeAddressContains = parseOptionalSearchField(input.storeAddressContains, "storeAddressContains");
  if (storeAddressContains === null) {
    return { ok: false, message: "Некорректный фильтр адреса ТТ." };
  }
  const filled = parseOptionalSearchField(input.filled, "filled");
  if (filled === null) {
    return { ok: false, message: "Некорректный фильтр заполненности." };
  }
  const empty = parseOptionalSearchField(input.empty, "empty");
  if (empty === null) {
    return { ok: false, message: "Некорректный фильтр пустоты." };
  }

  const filledEmptyValidation = validateFilledEmptyFields(filled, empty, entityRaw as ClientsEntityMode);
  if (!filledEmptyValidation.ok) {
    return { ok: false, message: filledEmptyValidation.message };
  }

  const discountProgram = parseOptionalSearchField(input.discountProgram, "discountProgram");
  if (discountProgram === null) {
    return { ok: false, message: "Некорректный фильтр Discount." };
  }
  if (entityRaw === "outlets" && discountProgram) {
    return { ok: false, message: "Поле «discountProgram» недоступно для фильтрации в режиме торговых точек." };
  }

  const discountAmountMin = parseOptionalStrictNumber(input.discountAmountMin);
  if (discountAmountMin === null) {
    return { ok: false, message: "Некорректный минимум DiscountAmount." };
  }
  const discountAmountMax = parseOptionalStrictNumber(input.discountAmountMax);
  if (discountAmountMax === null) {
    return { ok: false, message: "Некорректный максимум DiscountAmount." };
  }
  if (entityRaw === "outlets" && (discountAmountMin !== undefined || discountAmountMax !== undefined)) {
    return { ok: false, message: "Диапазон DiscountAmount недоступен в режиме торговых точек." };
  }
  if (
    discountAmountMin !== undefined &&
    discountAmountMax !== undefined &&
    discountAmountMin > discountAmountMax
  ) {
    return { ok: false, message: "Минимум DiscountAmount не может быть больше максимума." };
  }

  const markupName = parseOptionalSearchField(input.markupName, "markupName");
  if (markupName === null) {
    return { ok: false, message: "Некорректный фильтр Markups." };
  }
  const markupPercentage = parseOptionalStrictNumber(input.markupPercentage);
  if (markupPercentage === null) {
    return { ok: false, message: "Некорректный фильтр Percentage." };
  }
  if (entityRaw === "outlets" && (markupName || markupPercentage !== undefined)) {
    return { ok: false, message: "Фильтр Markups недоступен в режиме торговых точек." };
  }

  const lprNameContains = parseOptionalSearchField(input.lprNameContains, "lprNameContains");
  if (lprNameContains === null) {
    return { ok: false, message: "Некорректный фильтр ФИО ЛПР." };
  }
  const lprPostContains = parseOptionalSearchField(input.lprPostContains, "lprPostContains");
  if (lprPostContains === null) {
    return { ok: false, message: "Некорректный фильтр должности ЛПР." };
  }
  const lprPhoneContains = parseOptionalSearchField(input.lprPhoneContains, "lprPhoneContains");
  if (lprPhoneContains === null) {
    return { ok: false, message: "Некорректный фильтр телефона ЛПР." };
  }
  const lprEmailContains = parseOptionalSearchField(input.lprEmailContains, "lprEmailContains");
  if (lprEmailContains === null) {
    return { ok: false, message: "Некорректный фильтр email ЛПР." };
  }
  const lprBonusContains = parseOptionalSearchField(input.lprBonusContains, "lprBonusContains");
  if (lprBonusContains === null) {
    return { ok: false, message: "Некорректный фильтр бонуса ЛПР." };
  }
  const lprConditionsBonusContains = parseOptionalSearchField(
    input.lprConditionsBonusContains,
    "lprConditionsBonusContains",
  );
  if (lprConditionsBonusContains === null) {
    return { ok: false, message: "Некорректный фильтр условий бонуса ЛПР." };
  }
  const lprDateOfBirth = parseOptionalIsoDateField(input.lprDateOfBirth, "lprDateOfBirth");
  if (lprDateOfBirth === null) {
    return { ok: false, message: "Некорректная дата рождения ЛПР (ожидается YYYY-MM-DD)." };
  }
  const lprDateOfBirthFrom = parseOptionalIsoDateField(input.lprDateOfBirthFrom, "lprDateOfBirthFrom");
  if (lprDateOfBirthFrom === null) {
    return { ok: false, message: "Некорректная начальная дата рождения ЛПР." };
  }
  const lprDateOfBirthTo = parseOptionalIsoDateField(input.lprDateOfBirthTo, "lprDateOfBirthTo");
  if (lprDateOfBirthTo === null) {
    return { ok: false, message: "Некорректная конечная дата рождения ЛПР." };
  }
  if (
    lprDateOfBirthFrom &&
    lprDateOfBirthTo &&
    lprDateOfBirthFrom > lprDateOfBirthTo
  ) {
    return { ok: false, message: "Начальная дата рождения ЛПР не может быть позже конечной." };
  }

  let bonusTandoorClub: string | undefined;
  if (input.bonusTandoorClub !== undefined && input.bonusTandoorClub !== null && input.bonusTandoorClub !== "") {
    if (rejectNonScalar(input.bonusTandoorClub)) {
      return { ok: false, message: "Некорректный фильтр Bonus Tandoor Club." };
    }
    const raw = String(input.bonusTandoorClub).trim();
    if (raw.length > MAX_SEARCH_LENGTH) {
      return { ok: false, message: "Слишком длинный фильтр Bonus Tandoor Club." };
    }
    bonusTandoorClub = raw;
  }

  const storePhoneContains = parseOptionalSearchField(input.storePhoneContains, "storePhoneContains");
  if (storePhoneContains === null) {
    return { ok: false, message: "Некорректный фильтр телефона магазина." };
  }
  const accountantPhoneContains = parseOptionalSearchField(input.accountantPhoneContains, "accountantPhoneContains");
  if (accountantPhoneContains === null) {
    return { ok: false, message: "Некорректный фильтр телефона бухгалтерии." };
  }
  const accountantEmailContains = parseOptionalSearchField(input.accountantEmailContains, "accountantEmailContains");
  if (accountantEmailContains === null) {
    return { ok: false, message: "Некорректный фильтр email бухгалтерии." };
  }
  const loadingTime = parseOptionalSearchField(input.loadingTime, "loadingTime");
  if (loadingTime === null) {
    return { ok: false, message: "Некорректный фильтр времени приёмки." };
  }

  if (rejectNonScalar(input.loadingSchedule)) {
    return { ok: false, message: "Некорректный фильтр расписания приёмки." };
  }
  const loadingScheduleRaw = parseScalarString(input.loadingSchedule, "all") ?? "all";
  if (loadingScheduleRaw !== "all" && loadingScheduleRaw !== "yes" && loadingScheduleRaw !== "no") {
    return { ok: false, message: "Некорректный фильтр расписания приёмки." };
  }

  const legacyManagerIds = parseUuidListParam(input.manager) ?? [];
  const legacyRegionalIds = parseUuidListParam(input.regionalManager) ?? [];
  const legacyHardwareIds = parseUuidListParam(input.hardwareManager) ?? [];
  const legacyRegionalMode = parseAssignmentPresenceMode(input.regionalManagerMode);
  if (legacyRegionalMode === null) {
    return { ok: false, message: "Некорректный режим фильтра регионального менеджера." };
  }
  const legacyHardwareMode = parseAssignmentPresenceMode(input.hardwareManagerMode);
  if (legacyHardwareMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера по фурнитуре." };
  }
  const legacyRopMode = parseAssignmentPresenceMode(input.ropEmployeeMode);
  if (legacyRopMode === null) {
    return { ok: false, message: "Некорректный режим фильтра РОП." };
  }

  const missingRop = assignment.missingClientRop ?? assignment.missingOutletRop;
  const missingManager = assignment.missingClientManager ?? assignment.missingOutletManager;
  const missingRegional = assignment.missingClientRegional ?? assignment.missingOutletRegional;
  const missingHardware = assignment.missingClientHardware ?? assignment.missingOutletHardware;

  if (assignment.missingClientRop && (assignment.clientRopEmployeeGuid || assignment.clientRopEmployeeMode)) {
    return { ok: false, message: "Нельзя одновременно выбрать РОП клиента и фильтр «РОП не указан»." };
  }
  if (assignment.missingOutletRop && (assignment.outletRopEmployeeGuid || assignment.outletRopEmployeeMode)) {
    return { ok: false, message: "Нельзя одновременно выбрать РОП ТТ и фильтр «РОП не указан»." };
  }
  if (
    assignment.missingClientRegional &&
    (assignment.clientRegionalManagerId ||
      (assignment.clientRegionalManagerIds && assignment.clientRegionalManagerIds.length > 0) ||
      assignment.clientRegionalManagerMode)
  ) {
    return {
      ok: false,
      message: "Нельзя одновременно выбрать регионального клиента и фильтр «не указан».",
    };
  }
  if (
    assignment.missingOutletRegional &&
    (assignment.outletRegionalManagerId ||
      (assignment.outletRegionalManagerIds && assignment.outletRegionalManagerIds.length > 0) ||
      assignment.outletRegionalManagerMode)
  ) {
    return {
      ok: false,
      message: "Нельзя одновременно выбрать регионального ТТ и фильтр «не указан».",
    };
  }
  if (
    assignment.missingClientHardware &&
    (assignment.clientHardwareManagerId ||
      (assignment.clientHardwareManagerIds && assignment.clientHardwareManagerIds.length > 0) ||
      assignment.clientHardwareManagerMode)
  ) {
    return {
      ok: false,
      message: "Нельзя одновременно выбрать менеджера по фурнитуре клиента и фильтр «не указан».",
    };
  }
  if (
    assignment.missingOutletHardware &&
    (assignment.outletHardwareManagerId ||
      (assignment.outletHardwareManagerIds && assignment.outletHardwareManagerIds.length > 0) ||
      assignment.outletHardwareManagerMode)
  ) {
    return {
      ok: false,
      message: "Нельзя одновременно выбрать менеджера по фурнитуре ТТ и фильтр «не указан».",
    };
  }
  if (
    assignment.missingClientManager &&
    (assignment.clientManagerId ||
      (assignment.clientManagerIds && assignment.clientManagerIds.length > 0) ||
      assignment.clientManagerMode)
  ) {
    return { ok: false, message: "Нельзя одновременно выбрать менеджера клиента и фильтр «не указан»." };
  }
  if (
    assignment.missingOutletManager &&
    (assignment.outletManagerId ||
      (assignment.outletManagerIds && assignment.outletManagerIds.length > 0) ||
      assignment.outletManagerMode)
  ) {
    return { ok: false, message: "Нельзя одновременно выбрать менеджера ТТ и фильтр «не указан»." };
  }

  const sortDir = parseSortDirection(input.sortDir);
  if (sortDir === null) {
    return { ok: false, message: "Некорректное направление сортировки." };
  }
  const sortBy = parseSortBy(entityRaw as ClientsEntityMode, input.sortBy);
  if (sortBy === null) {
    return { ok: false, message: "Некорректное поле сортировки." };
  }

  const branchPortfolio = parseBranchPortfolio(input.portfolio);
  if (branchPortfolio === null) {
    return { ok: false, message: "Некорректный параметр portfolio." };
  }

  let onecTeamGuid: string | undefined;
  if (input.onecTeam !== undefined && input.onecTeam !== null && input.onecTeam !== "") {
    if (rejectNonScalar(input.onecTeam)) {
      return { ok: false, message: "Некорректный фильтр группы 1С." };
    }
    const rawTeam = String(input.onecTeam).trim().toLowerCase();
    if (rawTeam === ONEC_TEAM_UNDEFINED_KEY) {
      onecTeamGuid = ONEC_TEAM_UNDEFINED_KEY;
    } else if (!isValidUuidParam(rawTeam)) {
      return { ok: false, message: "Некорректный фильтр группы 1С." };
    } else {
      onecTeamGuid = rawTeam;
    }
  }

  let teamSource: "onec" | undefined;
  if (input.teamSource !== undefined && input.teamSource !== null && input.teamSource !== "") {
    if (rejectNonScalar(input.teamSource)) {
      return { ok: false, message: "Некорректный источник команд." };
    }
    const rawSource = String(input.teamSource).trim().toLowerCase();
    if (rawSource !== "onec") {
      return { ok: false, message: "Некорректный источник команд." };
    }
    teamSource = "onec";
  }

  const responsibleKind = parseResponsibleAssignmentKind(input.responsibleKind);
  if (responsibleKind === null) {
    return { ok: false, message: "Некорректный тип назначения ответственного." };
  }

  const managerId =
    assignment.clientManagerId ??
    assignment.outletManagerId ??
    (legacyManagerIds.length === 1 ? legacyManagerIds[0] : undefined);
  const managerIds =
    assignment.clientManagerIds ??
    assignment.outletManagerIds ??
    (legacyManagerIds.length > 0 ? legacyManagerIds : undefined);

  return {
    ok: true,
    query: {
      entity: entityRaw as ClientsEntityMode,
      view: viewRaw as ClientsViewMode,
      q: rawQ,
      managerId,
      managerIds,
      clientManagerId: assignment.clientManagerId,
      clientManagerIds: assignment.clientManagerIds,
      outletManagerId: assignment.outletManagerId,
      outletManagerIds: assignment.outletManagerIds,
      holdingId,
      phone: phoneNormalized as PhoneFilter,
      ropUserId,
      ropEmployeeGuid,
      clientRopEmployeeGuid: assignment.clientRopEmployeeGuid,
      outletRopEmployeeGuid: assignment.outletRopEmployeeGuid,
      branchPortfolio,
      onecTeamGuid,
      teamSource,
      responsibleKind,
      hardwareManagerId: assignment.clientHardwareManagerId ?? assignment.outletHardwareManagerId,
      hardwareManagerIds:
        assignment.clientHardwareManagerIds ??
        assignment.outletHardwareManagerIds ??
        (legacyHardwareIds.length > 0 ? legacyHardwareIds : undefined),
      regionalManagerId: assignment.clientRegionalManagerId ?? assignment.outletRegionalManagerId,
      regionalManagerIds:
        assignment.clientRegionalManagerIds ??
        assignment.outletRegionalManagerIds ??
        (legacyRegionalIds.length > 0 ? legacyRegionalIds : undefined),
      clientRegionalManagerId: assignment.clientRegionalManagerId,
      clientRegionalManagerIds: assignment.clientRegionalManagerIds,
      outletRegionalManagerId: assignment.outletRegionalManagerId,
      outletRegionalManagerIds: assignment.outletRegionalManagerIds,
      clientHardwareManagerId: assignment.clientHardwareManagerId,
      clientHardwareManagerIds: assignment.clientHardwareManagerIds,
      outletHardwareManagerId: assignment.outletHardwareManagerId,
      outletHardwareManagerIds: assignment.outletHardwareManagerIds,
      clientManagerMode: assignment.clientManagerMode,
      outletManagerMode: assignment.outletManagerMode,
      clientRegionalManagerMode: assignment.clientRegionalManagerMode,
      outletRegionalManagerMode: assignment.outletRegionalManagerMode,
      clientHardwareManagerMode: assignment.clientHardwareManagerMode,
      outletHardwareManagerMode: assignment.outletHardwareManagerMode,
      clientRopEmployeeMode: assignment.clientRopEmployeeMode,
      outletRopEmployeeMode: assignment.outletRopEmployeeMode,
      regionalManagerMode: legacyRegionalMode,
      hardwareManagerMode: legacyHardwareMode,
      ropEmployeeMode: legacyRopMode,
      completenessReasons,
      completenessReasonMode: completenessReasonMode ?? "any",
      missingRop,
      missingManager,
      missingRegional,
      missingHardware,
      missingClientManager: assignment.missingClientManager,
      missingOutletManager: assignment.missingOutletManager,
      missingClientRegional: assignment.missingClientRegional,
      missingOutletRegional: assignment.missingOutletRegional,
      missingClientHardware: assignment.missingClientHardware,
      missingOutletHardware: assignment.missingOutletHardware,
      missingClientRop: assignment.missingClientRop,
      missingOutletRop: assignment.missingOutletRop,
      unassignedCategory,
      reviewState,
      reviewDecision,
      hasOutlets: outletsRaw as OutletsFilter,
      outletStatus: outletStatusRaw as OutletStatusFilter,
      warehouseFilter: warehouseRaw as OutletWarehouseFilter,
      tandoorClub,
      routeDirection,
      storeAddressContains,
      storePhoneContains,
      accountantPhoneContains,
      accountantEmailContains,
      loadingTime,
      loadingSchedule: loadingScheduleRaw as LoadingScheduleFilter,
      filled,
      empty,
      discountProgram,
      discountAmountMin,
      discountAmountMax,
      markupName,
      markupPercentage,
      bonusTandoorClub,
      lprNameContains,
      lprPostContains,
      lprPhoneContains,
      lprEmailContains,
      lprBonusContains,
      lprConditionsBonusContains,
      lprDateOfBirth,
      lprDateOfBirthFrom,
      lprDateOfBirthTo,
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

  const orgTeamsManagerHandled = Boolean(query.ropEmployeeGuid) && Boolean(query.managerId);
  const outletEntityManagerHandled = query.entity === "outlets";
  const clientManagerIds = query.clientManagerIds ?? (query.entity === "clients" ? query.managerIds : undefined);
  const clientManagerId = query.clientManagerId ?? (query.entity === "clients" ? query.managerId : undefined);
  if (
    clientManagerIds &&
    clientManagerIds.length > 0 &&
    !orgTeamsManagerHandled &&
    !outletEntityManagerHandled
  ) {
    params.push(clientManagerIds);
    clauses.push(`onec_clients.guid_manager = ANY($${params.length}::uuid[])`);
  } else if (clientManagerId && !orgTeamsManagerHandled && !outletEntityManagerHandled) {
    params.push(clientManagerId);
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

/** True when any list filter narrows or reshapes the default clients/outlets query. */
export function queryHasActiveFilters(query: ClientsListQuery): boolean {
  return Boolean(
    query.q ||
      query.managerId ||
      (query.managerIds && query.managerIds.length > 0) ||
      query.clientManagerId ||
      (query.clientManagerIds && query.clientManagerIds.length > 0) ||
      query.outletManagerId ||
      (query.outletManagerIds && query.outletManagerIds.length > 0) ||
      query.holdingId ||
      query.phone !== "all" ||
      query.view !== "all" ||
      query.entity !== "clients" ||
      query.ropUserId ||
      query.ropEmployeeGuid ||
      query.clientRopEmployeeGuid ||
      query.outletRopEmployeeGuid ||
      query.branchPortfolio ||
      query.onecTeamGuid ||
      query.teamSource ||
      query.responsibleKind ||
      query.unassignedCategory ||
      (query.reviewState && query.reviewState !== "any") ||
      (query.reviewDecision && query.reviewDecision !== "any") ||
      query.hasOutlets !== "all" ||
      query.outletStatus !== "all" ||
      query.warehouseFilter !== "all" ||
      query.regionalManagerId ||
      (query.regionalManagerIds && query.regionalManagerIds.length > 0) ||
      query.clientRegionalManagerId ||
      (query.clientRegionalManagerIds && query.clientRegionalManagerIds.length > 0) ||
      query.outletRegionalManagerId ||
      (query.outletRegionalManagerIds && query.outletRegionalManagerIds.length > 0) ||
      query.hardwareManagerId ||
      (query.hardwareManagerIds && query.hardwareManagerIds.length > 0) ||
      query.clientHardwareManagerId ||
      (query.clientHardwareManagerIds && query.clientHardwareManagerIds.length > 0) ||
      query.outletHardwareManagerId ||
      (query.outletHardwareManagerIds && query.outletHardwareManagerIds.length > 0) ||
      query.missingRop ||
      query.missingManager ||
      query.missingRegional ||
      query.missingHardware ||
      query.missingClientManager ||
      query.missingOutletManager ||
      query.missingClientRegional ||
      query.missingOutletRegional ||
      query.missingClientHardware ||
      query.missingOutletHardware ||
      query.missingClientRop ||
      query.missingOutletRop ||
      query.tandoorClub ||
      query.routeDirection ||
      query.storeAddressContains ||
      query.storePhoneContains ||
      query.accountantPhoneContains ||
      query.accountantEmailContains ||
      query.loadingTime ||
      query.loadingSchedule !== "all" ||
      query.filled ||
      query.empty ||
      query.discountProgram ||
      query.discountAmountMin !== undefined ||
      query.discountAmountMax !== undefined ||
      query.markupName ||
      query.markupPercentage !== undefined ||
      query.bonusTandoorClub ||
      query.lprNameContains ||
      query.lprPostContains ||
      query.lprPhoneContains ||
      query.lprEmailContains ||
      query.lprBonusContains ||
      query.lprConditionsBonusContains ||
      query.lprDateOfBirth ||
      query.lprDateOfBirthFrom ||
      query.lprDateOfBirthTo ||
      (query.completenessReasons && query.completenessReasons.length > 0) ||
      query.clientManagerMode ||
      query.outletManagerMode ||
      query.clientRegionalManagerMode ||
      query.outletRegionalManagerMode ||
      query.clientHardwareManagerMode ||
      query.outletHardwareManagerMode ||
      query.clientRopEmployeeMode ||
      query.outletRopEmployeeMode ||
      query.regionalManagerMode ||
      query.hardwareManagerMode ||
      query.ropEmployeeMode,
  );
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
