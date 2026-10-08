import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE } from "../constants";
import { isValidUuidParam } from "../uuid-param";
import {
  COMPLETENESS_REASONS,
  type CompletenessReason,
} from "./completeness-reasons";
import {
  CompletenessAccessError,
  listCompletenessQueue,
  type CompletenessQueueQuery,
} from "./completeness-repository";
import {
  getOnecTeamGroupsOverview,
  ONEC_TEAM_UNDEFINED_KEY,
  OrgOnecTeamsSourceError,
} from "./onec-teams-repository";
import {
  getOrgStructureOverview,
  listOrgRopResponsibles,
  OrgStructureAccessError,
} from "./structure-repository";

function sendOrgError(res: Response, error: OrgStructureAccessError): void {
  setNoStore(res);
  if (error.code === "FORBIDDEN") {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
    return;
  }
  res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, error.message));
}

export async function orgStructureOverviewHandler(req: AccessRequest, res: Response): Promise<void> {
  try {
    const overview = await getOrgStructureOverview(req.accessContext!);
    setNoStore(res);
    res.status(200).json(overview);
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      sendOrgError(res, error);
      return;
    }
    throw error;
  }
}

function parseOnecTeamsQuery(input: Record<string, unknown>): { q: string; onecTeam?: string } | { error: string } {
  const q = typeof input.q === "string" ? input.q.trim() : typeof input.teamQ === "string" ? input.teamQ.trim() : "";
  const rawTeam =
    typeof input.onecTeam === "string"
      ? input.onecTeam.trim().toLowerCase()
      : typeof input.team === "string"
        ? input.team.trim().toLowerCase()
        : "";
  if (!rawTeam) {
    return { q, onecTeam: undefined };
  }
  if (rawTeam === ONEC_TEAM_UNDEFINED_KEY) {
    return { q, onecTeam: ONEC_TEAM_UNDEFINED_KEY };
  }
  if (!isValidUuidParam(rawTeam)) {
    return { error: "Некорректный фильтр группы 1С." };
  }
  return { q, onecTeam: rawTeam };
}

export async function orgOnecTeamsHandler(req: AccessRequest, res: Response): Promise<void> {
  const parsed = parseOnecTeamsQuery(req.query as Record<string, unknown>);
  if ("error" in parsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.error));
    return;
  }

  try {
    const overview = await getOnecTeamGroupsOverview(req.accessContext!, parsed);
    setNoStore(res);
    res.status(200).json(overview);
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      sendOrgError(res, error);
      return;
    }
    if (error instanceof OrgOnecTeamsSourceError) {
      setNoStore(res);
      res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, error.message));
      return;
    }
    throw error;
  }
}

export async function orgRopResponsiblesHandler(req: AccessRequest, res: Response): Promise<void> {
  const ropEmployeeGuid =
    typeof req.params.ropEmployeeGuid === "string" ? req.params.ropEmployeeGuid.trim().toLowerCase() : "";
  if (!isValidUuidParam(ropEmployeeGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный GUID РОП."));
    return;
  }

  try {
    const items = await listOrgRopResponsibles(req.accessContext!, ropEmployeeGuid);
    setNoStore(res);
    res.status(200).json({ items });
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      sendOrgError(res, error);
      return;
    }
    throw error;
  }
}

function parseCompletenessQuery(input: Record<string, unknown>): CompletenessQueueQuery | { error: string } {
  const pageRaw = input.page;
  let page = MIN_PAGE;
  if (pageRaw !== undefined && pageRaw !== null && pageRaw !== "") {
    const parsed = Number(String(pageRaw));
    if (!Number.isSafeInteger(parsed) || parsed < MIN_PAGE) {
      return { error: "Некорректный номер страницы." };
    }
    page = parsed;
  }

  const pageSizeRaw = input.pageSize;
  let pageSize = DEFAULT_PAGE_SIZE;
  if (pageSizeRaw !== undefined && pageSizeRaw !== null && pageSizeRaw !== "") {
    const parsed = Number(String(pageSizeRaw));
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      return { error: "Некорректный размер страницы." };
    }
    pageSize = parsed;
  }

  const q = typeof input.q === "string" ? input.q.trim() : "";

  let reasons: CompletenessReason[] = [];
  const rawReasons = input.completenessReason ?? input.reason ?? input.reasons;
  if (rawReasons !== undefined && rawReasons !== null && rawReasons !== "") {
    const values = Array.isArray(rawReasons) ? rawReasons : [rawReasons];
    for (const value of values) {
      const raw = String(value).trim();
      if (!(COMPLETENESS_REASONS as readonly string[]).includes(raw)) {
        return { error: "Некорректная причина неполноты." };
      }
      reasons.push(raw as CompletenessReason);
    }
  }

  const reasonModeRaw = typeof input.reasonMode === "string" ? input.reasonMode.trim() : "any";
  if (reasonModeRaw !== "any" && reasonModeRaw !== "all") {
    return { error: "Некорректный режим фильтра причин." };
  }

  let entityKind: "client" | "outlet" | undefined;
  const rawEntityKind =
    input.entityKind !== undefined && input.entityKind !== null && input.entityKind !== ""
      ? String(input.entityKind).trim()
      : input.entity !== undefined && input.entity !== null && input.entity !== ""
        ? String(input.entity).trim()
        : "";
  if (rawEntityKind) {
    if (rawEntityKind === "client" || rawEntityKind === "clients") {
      entityKind = "client";
    } else if (rawEntityKind === "outlet" || rawEntityKind === "outlets") {
      entityKind = "outlet";
    } else {
      return { error: "Некорректный тип записи." };
    }
  }

  let ropEmployeeGuid: string | undefined;
  if (input.ropEmployee !== undefined && input.ropEmployee !== null && input.ropEmployee !== "") {
    if (typeof input.ropEmployee !== "string" || !isValidUuidParam(input.ropEmployee)) {
      return { error: "Некорректный фильтр РОП." };
    }
    ropEmployeeGuid = input.ropEmployee.trim().toLowerCase();
  }

  let managerId: string | undefined;
  if (input.manager !== undefined && input.manager !== null && input.manager !== "") {
    if (typeof input.manager !== "string" || !isValidUuidParam(input.manager)) {
      return { error: "Некорректный фильтр менеджера." };
    }
    managerId = input.manager.trim().toLowerCase();
  }

  let regionalManagerId: string | undefined;
  if (input.regionalManager !== undefined && input.regionalManager !== null && input.regionalManager !== "") {
    if (typeof input.regionalManager !== "string" || !isValidUuidParam(input.regionalManager)) {
      return { error: "Некорректный фильтр регионального менеджера." };
    }
    regionalManagerId = input.regionalManager.trim().toLowerCase();
  }

  let reviewState: string | undefined;
  if (input.reviewState !== undefined && input.reviewState !== null && input.reviewState !== "") {
    reviewState = String(input.reviewState).trim();
  }

  return {
    q,
    reasons,
    reasonMode: reasonModeRaw,
    entityKind,
    ropEmployeeGuid,
    managerId,
    regionalManagerId,
    reviewState,
    page,
    pageSize,
  };
}

export async function completenessQueueHandler(req: AccessRequest, res: Response): Promise<void> {
  const parsed = parseCompletenessQuery(req.query as Record<string, unknown>);
  if ("error" in parsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.error));
    return;
  }

  try {
    const result = await listCompletenessQueue(req.accessContext!, parsed);
    setNoStore(res);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof CompletenessAccessError) {
      setNoStore(res);
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
      return;
    }
    throw error;
  }
}
