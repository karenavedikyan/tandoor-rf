import type { AccessContext } from "../access/types";
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
  showViewSwitcher: boolean;
  showManagerTeamFilter: boolean;
  showTeamNavigation: boolean;
  reviewReadOnly: boolean;
  cardFocusHints: readonly string[];
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

export function canUseReviewNavigation(context: AccessContext): boolean {
  return context.role === "admin" || (context.role === "director" && context.fullClientBase);
}

export function canUseUnassignedNavigation(context: AccessContext): boolean {
  return canUseReviewNavigation(context);
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
        clientsHref: "/clients",
        defaultView: "all",
        defaultEntity: "clients",
        allowedViews: ["all"],
        allowedEntities: ["clients", "outlets"],
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
        clientsHref: "/clients?entity=outlets",
        defaultView: "all",
        defaultEntity: "outlets",
        allowedViews: ["all"],
        allowedEntities: ["outlets", "clients"],
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
        clientsHref: "/clients?view=teams",
        defaultView: "teams",
        defaultEntity: "clients",
        allowedViews: ["all", "teams"],
        allowedEntities: ["clients"],
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: true,
        cardFocusHints: ROP_FOCUS,
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
        clientsHref: "/clients?view=teams",
        defaultView: "teams",
        defaultEntity: "clients",
        allowedViews: ["all", "teams", "review"],
        allowedEntities: ["clients", "outlets"],
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: true,
        cardFocusHints: DIRECTOR_FOCUS,
      };

    case "admin":
      return {
        businessRole,
        pageTitle: "Клиенты",
        workHubTitle: null,
        workHubPrimaryActionLabel: null,
        clientsHref: "/clients?view=all",
        defaultView: "all",
        defaultEntity: "clients",
        allowedViews: ["all", "teams", "review"],
        allowedEntities: ["clients", "outlets"],
        showViewSwitcher: true,
        showManagerTeamFilter: true,
        showTeamNavigation: true,
        reviewReadOnly: false,
        cardFocusHints: DIRECTOR_FOCUS,
      };

    case "assistant":
      return {
        businessRole,
        pageTitle: "Клиенты замещения",
        workHubTitle: null,
        workHubPrimaryActionLabel: null,
        clientsHref: "/clients",
        defaultView: "all",
        defaultEntity: "clients",
        allowedViews: ["all"],
        allowedEntities: ["clients"],
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
