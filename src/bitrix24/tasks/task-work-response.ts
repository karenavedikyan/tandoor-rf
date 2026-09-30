import type { AccessContext } from "../../access/types";
import { formatMskDateTime } from "../../clients/dto";
import type { Bitrix24ObjectType } from "../labels/format";
import { buildTaskPortalUrl } from "./portal-url";
import { formatBoundObjectLabel } from "./object-type-labels";
import { formatTaskStatusLabel } from "./status-labels";
import { buildTaskOverviewMetadata } from "./overview-metadata";
import { resolveConfirmedResponsibleProfile } from "./responsible-profile";
import type { TaskCacheRow, TaskBindingRow } from "./repository";
import {
  canMutateBitrixTaskContactAction,
  canViewBitrixTaskSummaryForUser,
  canViewFullBitrixTaskForUser,
} from "./work-access";
import { buildChecklistPublicDto } from "./checklist-dto";
import {
  findActiveContactAction,
  findActiveSummaryPublication,
} from "./work-repository";

function formatDisplayDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return formatMskDateTime(date);
}

async function buildContactActionDto(
  context: AccessContext,
  portalId: string,
  task: TaskCacheRow & TaskBindingRow,
  cardGuid: string,
  actorDisplayName: string,
): Promise<Record<string, unknown> | null> {
  if (
    !(await canMutateBitrixTaskContactAction(context, portalId, task, cardGuid)) ||
    !task.objectType ||
    !task.objectGuid
  ) {
    return null;
  }
  const action = await findActiveContactAction(
    portalId,
    task.taskId,
    task.objectType,
    task.objectGuid,
    context.userId,
  );
  return {
    marked: Boolean(action),
    markedAt: action?.markedAt ?? null,
    markedAtLabel: action ? formatDisplayDate(action.markedAt) : null,
    markedByDisplayName: action ? actorDisplayName : null,
    comment: action?.commentText ?? null,
    canMark: true,
    canRevoke: Boolean(action),
  };
}

async function buildResponsibleDto(portalId: string, bitrixUserId: string | null) {
  const profile = await resolveConfirmedResponsibleProfile(portalId, bitrixUserId);
  if (profile.state === "confirmed") {
    return {
      state: "confirmed" as const,
      displayName: profile.displayName,
      internalContactEmail: profile.email,
      internalContactUserId: profile.lkUserId,
    };
  }
  return {
    state: "unknown" as const,
    displayName: null,
    internalContactEmail: null,
    internalContactUserId: null,
  };
}

export async function buildFullTaskWorkDto(input: {
  context: AccessContext;
  portalId: string;
  cardGuid: string;
  portalHost: string;
  portalPublicUrl: string | null;
  task: TaskCacheRow & TaskBindingRow;
  actorDisplayName: string;
}): Promise<Record<string, unknown> | null> {
  if (
    !(await canViewFullBitrixTaskForUser(
      input.context,
      input.portalId,
      input.task,
      input.cardGuid,
    ))
  ) {
    return null;
  }
  const contactAction = await buildContactActionDto(
    input.context,
    input.portalId,
    input.task,
    input.cardGuid,
    input.actorDisplayName,
  );
  const checklist = await buildChecklistPublicDto({
    portalId: input.portalId,
    taskId: input.task.taskId,
    objectType: input.task.objectType ?? null,
    objectGuid: input.task.objectGuid ?? null,
  });
  return {
    taskId: input.task.taskId,
    accessLevel: "full",
    ...buildTaskOverviewMetadata(input.task.statusLabel, input.task.deadline, true),
    title: input.task.title,
    statusLabel: formatTaskStatusLabel(input.task.statusLabel),
    deadline: formatDisplayDate(input.task.deadline),
    changedAt: formatDisplayDate(input.task.changedAt),
    boundObjectLabel: formatBoundObjectLabel(input.task.objectType),
    portalUrl: buildTaskPortalUrl(
      input.portalHost,
      input.portalPublicUrl,
      input.task.taskId,
      input.task.responsibleBitrixUserId,
    ),
    responsible: await buildResponsibleDto(input.portalId, input.task.responsibleBitrixUserId),
    checklist,
    contactAction,
  };
}

export async function buildSummaryTaskWorkDto(input: {
  context: AccessContext;
  portalId: string;
  cardGuid: string;
  task: TaskCacheRow & TaskBindingRow;
  actorDisplayName: string;
}): Promise<Record<string, unknown> | null> {
  if (
    !(await canViewBitrixTaskSummaryForUser(
      input.context,
      input.portalId,
      input.task,
      input.cardGuid,
    )) ||
    !input.task.objectType ||
    !input.task.objectGuid
  ) {
    return null;
  }
  const publication = await findActiveSummaryPublication(
    input.portalId, input.task.taskId, input.task.objectType, input.task.objectGuid,
  );
  if (!publication) {
    return null;
  }
  const contactAction = await buildContactActionDto(
    input.context,
    input.portalId,
    input.task,
    input.cardGuid,
    input.actorDisplayName,
  );
  return {
    taskId: input.task.taskId,
    accessLevel: "summary",
    ...buildTaskOverviewMetadata(input.task.statusLabel, null, false),
    briefText: publication.briefText,
    statusLabel: formatTaskStatusLabel(input.task.statusLabel),
    boundObjectLabel: formatBoundObjectLabel(input.task.objectType),
    responsible: await buildResponsibleDto(input.portalId, input.task.responsibleBitrixUserId),
    contactAction,
  };
}

export function parseContactActionBody(body: unknown): {
  ok: true;
  marked: boolean;
  comment?: string | null;
} | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body is required." };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.marked !== "boolean") {
    return { ok: false, message: "marked must be a boolean." };
  }
  if (record.comment === undefined) {
    return { ok: true, marked: record.marked };
  }
  if (record.comment === null) {
    return { ok: true, marked: record.marked, comment: null };
  }
  if (typeof record.comment !== "string") {
    return { ok: false, message: "comment must be a string." };
  }
  const trimmed = record.comment.trim();
  if (trimmed.length > 2000) {
    return { ok: false, message: "comment is too long." };
  }
  return { ok: true, marked: record.marked, comment: trimmed.length > 0 ? trimmed : null };
}

export function resolveContactObjectType(raw: unknown): Bitrix24ObjectType | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "holding" || value === "legal_entity" || value === "outlet") {
    return value;
  }
  return null;
}
