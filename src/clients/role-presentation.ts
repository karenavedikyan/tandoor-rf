import type { AccessContext } from "../access/types";
import { selfRopEmployeeGuidFromContext } from "./self-rop-identity";
import type { UserRole } from "../shared/user";
import type { ClientsEntityMode, ClientsViewMode } from "./query";

export type BusinessClientsRole =
  | "manager"
  | "regional_manager"
  | "rop"
  | "director"
  | "admin"
  | "assistant"
  | "other";

export type V3ListEntity = "holdings" | "legal" | "legal_grouped" | "retail" | "orphan_retail";

export type RolePresentation = {
  businessRole: BusinessClientsRole;
  pageTitle: string;
  workHubTitle: string | null;
  workHubPrimaryActionLabel: string | null;
  clientsHref: string;
  defaultView: ClientsViewMode;
  defaultEntity: ClientsEntityMode;
  allowedViews: ClientsViewMode[];
  allowedEntities: ClientsEntityMode[];
  allowedV3Entities: readonly V3ListEntity[];
  /** When false, entity switcher stays hidden even if multiple entities are allowed. */
  showEntitySwitcher?: boolean;
  showViewSwitcher: boolean;
  showManagerTeamFilter: boolean;
  showTeamNavigation: boolean;
  reviewReadOnly: boolean;
  /** Director-style teams overview, stats strip, and completeness navigation. */
  directorLayout?: boolean;
  cardFocusHints: readonly string[];
  delegationContext?:
    | {
        mode: "single";
        delegatorName: string;
        clientCount: number;
      }
    | {
        mode: "multiple";
        delegatorCount: number;
        clientCount: number;
      }
    | null;
  /** Confirmed 1C ROP employee guid for the logged-in user; ROP role only. */
  selfRopEmployeeGuid?: string | null;
};

const MANAGER_FOCUS = [
  "Заказы и отгрузки",
  "Задачи",
  "Оплата и документы",
] as const;

const REGIONAL_FOCUS = [
  "Адреса и контакты",
  "Витрина точки",
  "Общие задачи",
] as const;

const ROP_FOCUS = [
  "Работа команды",
  "Вопросы по оплате",
  "План клиента",
] as const;

const DIRECTOR_FOCUS = [
  "Работа по клиенту",
  "Планы и результат",
  "Назначения и данные",
] as const;

const ALL_V3_ENTITIES = ["holdings", "legal_grouped", "retail", "orphan_retail"] as const satisfies readonly V3ListEntity[];
const MANAGER_V3_ENTITIES = ["legal_grouped", "retail"] as const satisfies readonly V3ListEntity[];
const ASSISTANT_V3_ENTITIES = ["legal_grouped"] as const satisfies readonly V3ListEntity[];

export function canUseReviewNavigation(context: AccessContext): boolean {
  return context.role === "admin" || (context.role === "director" && context.fullClientBase);
}

export function canUseUnassignedNavigation(context: AccessContext): boolean {
  return canUseReviewNavigation(context);
}

export function canUseCompletenessNavigation(context: AccessContext): boolean {
  return canUseReviewNavigation(context);
}

export function v3EntityFromLegacyEntity(entity: ClientsEntityMode): V3ListEntity {
  return entity === "outlets" ? "retail" : "legal_grouped";
}

export function v3ViewFromLegacyView(view: ClientsViewMode): "all" | "teams" | "unassigned" {
  if (view === "teams") {
    return "teams";
  }
  if (view === "review") {
    return "unassigned";
  }
  return "all";
}

export function buildRoleClientsHref(input: {
  view: ClientsViewMode;
  entity: ClientsEntityMode;
}): string {
  const params = new URLSearchParams();
  params.set("v3mode", "1");
  params.set("v3entity", v3EntityFromLegacyEntity(input.entity));
  const v3view = v3ViewFromLegacyView(input.view);
  if (input.view !== "all") {
    params.set("view", input.view);
  } else {
    params.set("view", "all");
  }
  if (v3view !== "all") {
    params.set("v3view", v3view);
  }
  if (input.entity !== "clients") {
    params.set("entity", input.entity);
  }
  return `/clients?${params.toString()}`;
}

export function resolveBusinessClientsRole(role: UserRole): BusinessClientsRole {
  switch (role) {
    case "manager":
    case "regional_manager":
    case "rop":
    case "director":
    case "admin":
    case "assistant":
      return role;
    default:
      return "other";
  }
}

export function validateClientsListQuery(
  context: AccessContext,
  query: { view: ClientsViewMode; entity: ClientsEntityMode },
): string | null {
  const presentation = resolveRolePresentation(context);
  if (!presentation) {
    return "Нет доступа к разделу клиентов.";
  }
  if (!presentation.allowedViews.includes(query.view)) {
    return "Режим просмотра недоступен для вашей роли.";
  }
  if (!presentation.allowedEntities.includes(query.entity)) {
    return "Режим списка недоступен для вашей роли.";
  }
  return null;
}

export function resolveRolePresentation(context: AccessContext): RolePresentation | null {
  if (context.status !== "active") {
    return null;
  }

  const businessRole = resolveBusinessClientsRole(context.role);

  switch (businessRole) {
    case "manager":
      return {
        businessRole,
        pageTitle: "Мои клиенты",
        workHubTitle: "Мой рабочий день",
        workHubPrimaryActionLabel: "Открыть моих клиентов",
        clientsHref: buildRoleClientsHref({ view: "all", entity: "clients" }),
        defaultView: "all",
        defaultEntity: "clients",
        allowedViews: ["all"],
        allowedEntities: ["clients", "outlets"],
        allowedV3Entities: MANAGER_V3_ENTITIES,
        showViewSwitcher: false,
        showManagerTeamFilter: false,
        showTeamNavigation: false,
        reviewReadOnly: true,
        cardFocusHints: MANAGER_FOCUS,
      };

    case "regional_manager":
      return {
        businessRole,
        pageTitle: "Мои торговые точки",
        workHubTitle: "Моя работа на территории",
        workHubPrimaryActionLabel: "Мои торговые точки",
        clientsHref: buildRoleClientsHref({ view: "all", entity: "outlets" }),
        defaultView: "all",
        defaultEntity: "outlets",
        allowedViews: ["all"],
        allowedEntities: ["outlets", "clients"],
        allowedV3Entities: MANAGER_V3_ENTITIES,
        showViewSwitcher: false,
        showManagerTeamFilter: false,
        showTeamNavigation: false,
        reviewReadOnly: true,
        cardFocusHints: REGIONAL_FOCUS,
      };

    case "rop":
      return {
        businessRole,
        pageTitle: "Клиенты моей команды",
        workHubTitle: "Обзор моей команды",
        workHubPrimaryActionLabel: null,
        clientsHref: buildRoleClientsHref({ view: "teams", entity: "clients" }),
        defaultView: "teams",
        defaultEntity: "clients",
        allowedViews: ["all", "teams"],
        allowedEntities: ["clients", "outlets"],
        allowedV3Entities: MANAGER_V3_ENTITIES,
        showEntitySwitcher: false,
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: true,
        cardFocusHints: ROP_FOCUS,
        selfRopEmployeeGuid: selfRopEmployeeGuidFromContext(context),
      };

    case "director":
      if (!context.fullClientBase) {
        return null;
      }
      return {
        businessRole,
        pageTitle: "Вся клиентская база",
        workHubTitle: "Обзор отдела ОПТ",
        workHubPrimaryActionLabel: null,
        clientsHref: buildRoleClientsHref({ view: "teams", entity: "clients" }),
        defaultView: "teams",
        defaultEntity: "clients",
        allowedViews: ["all", "teams", "review", "completeness"],
        allowedEntities: ["clients", "outlets"],
        allowedV3Entities: ALL_V3_ENTITIES,
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: true,
        directorLayout: true,
        cardFocusHints: DIRECTOR_FOCUS,
      };

    case "admin":
      return {
        businessRole,
        pageTitle: "Вся клиентская база",
        workHubTitle: null,
        workHubPrimaryActionLabel: null,
        clientsHref: buildRoleClientsHref({ view: "teams", entity: "clients" }),
        defaultView: "teams",
        defaultEntity: "clients",
        allowedViews: ["all", "teams", "review", "completeness"],
        allowedEntities: ["clients", "outlets"],
        allowedV3Entities: ALL_V3_ENTITIES,
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: false,
        directorLayout: true,
        cardFocusHints: DIRECTOR_FOCUS,
      };

    case "assistant":
      return {
        businessRole,
        pageTitle: "Клиенты замещения",
        workHubTitle: null,
        workHubPrimaryActionLabel: null,
        clientsHref: buildRoleClientsHref({ view: "all", entity: "clients" }),
        defaultView: "all",
        defaultEntity: "clients",
        allowedViews: ["all"],
        allowedEntities: ["clients"],
        allowedV3Entities: ASSISTANT_V3_ENTITIES,
        showViewSwitcher: false,
        showManagerTeamFilter: false,
        showTeamNavigation: false,
        reviewReadOnly: true,
        cardFocusHints: MANAGER_FOCUS,
      };

    default:
      return null;
  }
}
