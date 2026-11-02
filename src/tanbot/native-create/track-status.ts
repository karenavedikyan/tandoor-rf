import type { PoolClient } from "pg";
import type { AccessContext } from "../../access/types";
import { loadAccessContext } from "../../access/context";
import type { UserRole } from "../../shared/user";
import { buildNotificationTransferState, type NotificationTransferState } from "../../tan-tracker/notification-transfer-state";
import { canViewOrder } from "../../tan-tracker/scope";
import { mapTransferToOrderDto } from "../../tan-tracker/repository";
import { loadPartyEmployeeMap } from "../../tan-tracker/party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "../../tan-tracker/team-scope";
import { EXTERNAL_PERSON_PARTICIPANT_SQL } from "../../tan-tracker/external-person/external-person-orders";
import type { TanTrackerTimelineRow, TanTrackerTransferRow } from "../../tan-tracker/types";
import { buildTrackStatusCallback, type TrackStatusCallback } from "../track-status-callback";
import { buildNativeCreateCallback } from "./callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";
import { assertNativeCreateContext } from "./access-guard";
import { nativeVerifiedContactRequiredReply } from "./main-menu";
import { removeTelegramReplyKeyboard } from "./keyboards";
import type { NativeCreateContext, NativeCreateReply } from "./engine";

type StatusActor = { partyId: string | null; access: AccessContext | null };
const PAGE_SIZE = 5;
const NOT_AVAILABLE = "Трек не найден или недоступен вашему профилю.";
const line = (value: string, max = 160) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/gu, " ").trim().slice(0, max);

/** Read identity without creating/updating a party or minting a browser capability. */
async function statusActor(client: PoolClient, ctx: NativeCreateContext): Promise<StatusActor | null> {
  try { await assertNativeCreateContext(client, ctx); } catch { return null; }
  if (ctx.isLinkedStaff && ctx.staffUserId) {
    const prefix = ctx.channel === "max" ? "max" : "telegram";
    const row = (await client.query<{ party_id: string | null; role: UserRole }>(
      `SELECT p.id AS party_id,u.role FROM tanbot_${prefix}_accounts a
       JOIN users u ON u.id=a.user_id AND u.status='active'
       LEFT JOIN tt_parties p ON p.user_id=u.id AND p.kind='user'
       WHERE a.user_id=$1::uuid AND a.${prefix}_user_id=$2 AND a.${prefix}_chat_id=$3 AND a.stopped_at IS NULL`,
      [ctx.staffUserId, ctx.messengerUserId.toString(), ctx.messengerChatId],
    )).rows[0];
    return row ? { partyId: row.party_id, access: await loadAccessContext(ctx.staffUserId, row.role, client) } : null;
  }
  const row = (await client.query<{ party_id: string }>(
    `SELECT ep.party_id FROM tt_external_persons ep JOIN tt_external_person_verifications v ON v.person_id=ep.id
     WHERE ep.id=$1::uuid AND v.channel=$2 AND v.messenger_user_id=$3 AND v.messenger_chat_id=$4`,
    [ctx.personId, ctx.channel, ctx.messengerUserId.toString(), ctx.messengerChatId],
  )).rows[0];
  return row ? { partyId: row.party_id, access: null } : null;
}

async function visibleRows(
  client: PoolClient, actor: StatusActor, transferId?: string,
): Promise<TanTrackerTransferRow[]> {
  const rows = (await client.query<TanTrackerTransferRow>(
    `SELECT t.* FROM tt_transfers t WHERE t.deleted_at IS NULL
       AND ($2::text IS NULL OR t.id=$2 OR t.public_code=$2)
       AND ($3::boolean OR (${EXTERNAL_PERSON_PARTICIPANT_SQL}))
     ORDER BY t.updated_at DESC,t.id DESC ${transferId ? "FOR SHARE OF t" : ""}`,
    [actor.partyId, transferId ?? null, !!actor.access],
  )).rows;
  if (!actor.access || !rows.length) return rows;
  const ids = rows.map(r => r.id);
  const timeline = (await client.query<TanTrackerTimelineRow>(
    `SELECT id,transfer_id,occurred_at,from_party_id,to_party_id,note
     FROM tt_transfer_timeline WHERE transfer_id=ANY($1::text[]) ORDER BY occurred_at ASC`, [ids],
  )).rows;
  const revoked = (await client.query<{ transfer_id: string; party_id: string }>(
    `SELECT transfer_id,party_id FROM tt_transfer_revoked_parties WHERE transfer_id=ANY($1::text[])`, [ids],
  )).rows;
  const partyIds = [...new Set(rows.flatMap(r => [r.creator_party_id, r.holder_party_id, r.pending_party_id, r.final_recipient_party_id])
    .concat(timeline.flatMap(t => [t.from_party_id, t.to_party_id])).filter((id): id is string => !!id))];
  const map = await loadPartyEmployeeMap(client, partyIds);
  const team = await loadTanTrackerTeamEmployeeGuids(actor.access, client);
  return rows.filter(row => canViewOrder(
    mapTransferToOrderDto(row, timeline.filter(t => t.transfer_id === row.id),
      revoked.filter(r => r.transfer_id === row.id).map(r => r.party_id)),
    { userId: actor.access!.userId, role: actor.access!.role, employeeId: actor.access!.employeeId,
      actorPartyId: actor.partyId, previewReadOnly: !!actor.access!.preview?.readOnly },
    [], team, false, map,
  ));
}

function ui(ctx: NativeCreateContext, buttons: Array<{ text: string; data: string }>): Partial<NativeCreateReply> {
  return ctx.channel === "telegram" ? {
    replyMarkup: removeTelegramReplyKeyboard(),
    telegramInlineKeyboard: buttons.map(b => [{ text: b.text, callback_data: b.data }]),
  } : { maxInlineButtons: buttons.map(b => [{ type: "callback", text: b.text, payload: b.data }]) };
}
const menuButton = () => ({ text: "Главное меню", data: buildNativeCreateCallback("menu_home", NATIVE_MENU_DRAFT_HEX, 1)! });
const listButton = (page = 0) => ({ text: "К списку треков", data: buildTrackStatusCallback({ action: "list", page })! });

export function formatTrackStatus(
  row: Pick<TanTrackerTransferRow, "public_code" | "item_title" | "general_archived_at">,
  state: NotificationTransferState | undefined,
  now = new Date(),
): string {
  const phase = state?.phase;
  const label = phase === "obsolete" ? "Неактуален" : phase === "done" ? "Завершён" : phase === "received" ? "Получение подтверждено. Трек открыт"
    : phase === "waiting" ? "Ожидает подтверждения получения" : "Ожидает первой передачи";
  const lines = [`Трек ${line(row.public_code)}`, line(row.item_title), "", `Статус: ${label}`,
    `${phase === "done" || phase === "obsolete" ? "Последний держатель" : "Текущий держатель"}: ${state?.holderName || "Имя не указано"}`];
  if (phase === "obsolete") lines.push("Текущая передача отменена. Получение по ней не подтверждено.");
  if (phase === "waiting") lines.push(`Следующий получатель: ${state?.pendingName || "Имя не указано"}`,
    "Пока код не подтверждён, держатель не меняется.");
  if (phase === "ready") lines.push("Первое получение пока не подтверждено.");
  if (row.general_archived_at) lines.push("Трек в общем архиве.");
  lines.push("", `Данные на ${now.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`,
    "Для актуальной информации нажмите «Обновить статус».");
  return lines.join("\n");
}

export async function trackStatusReply(
  client: PoolClient, ctx: NativeCreateContext, request: TrackStatusCallback = { action: "list", page: 0 },
): Promise<NativeCreateReply> {
  const actor = await statusActor(client, ctx);
  if (!actor) {
    if (ctx.privateDialogOk && !ctx.isLinkedStaff && !ctx.personId) {
      return nativeVerifiedContactRequiredReply(ctx, "Подтвердите свой номер телефона, чтобы посмотреть доступные треки.");
    }
    return { text: "Статусы доступны только в личном диалоге с ботом при актуальном подключении профиля.", ...ui(ctx, [menuButton()]) };
  }
  if (request.action === "view") {
    const row = (await visibleRows(client, actor, request.transferId))[0];
    if (!row) return { text: NOT_AVAILABLE, ...ui(ctx, [listButton(), menuButton()]) };
    const state = await buildNotificationTransferState(client, row.id);
    return { text: formatTrackStatus(row, state), ...ui(ctx, [
      { text: "Обновить статус", data: buildTrackStatusCallback({ action: "view", transferId: row.id })! },
      listButton(), menuButton(),
    ]) };
  }
  const rows = await visibleRows(client, actor);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(request.page, pages - 1);
  const buttons = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).flatMap(row => {
    const data = buildTrackStatusCallback({ action: "view", transferId: row.id });
    return data ? [{ text: `${line(row.public_code, 30)} · ${line(row.item_title, 40)}`, data }] : [];
  });
  if (page > 0) buttons.push({ text: "Предыдущие", data: buildTrackStatusCallback({ action: "list", page: page - 1 })! });
  if (page + 1 < pages) buttons.push({ text: "Следующие", data: buildTrackStatusCallback({ action: "list", page: page + 1 })! });
  buttons.push(menuButton());
  return {
    text: rows.length ? `Статус трека\nВыберите трек. Страница ${page + 1} из ${pages}.\n\nТакже можно написать: Статус TT-2026-123.`
      : "Статус трека\nПока нет доступных треков с полным статусом.",
    ...ui(ctx, buttons),
  };
}
