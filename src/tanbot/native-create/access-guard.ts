import type { PoolClient } from "pg";
import { lockTanbotMaxMessenger, lockTanbotTelegramMessenger } from "../link-advisory-locks";
import { tanTrackerCanWrite } from "../../tan-tracker/guards";
import { loadAccessContext } from "../../access/context";
import type { UserDto } from "../../shared/user";
import type { NativeCreateContext } from "./engine";
import type { NativeCreateDraftPayload } from "./draft-scope";

export async function lockNativeCreateMessenger(client: PoolClient, ctx: NativeCreateContext): Promise<void> {
  if (ctx.channel === "telegram") {
    await lockTanbotTelegramMessenger(client, ctx.messengerUserId);
  } else {
    await lockTanbotMaxMessenger(client, ctx.messengerUserId);
  }
}

export async function assertNativeCreateContext(client: PoolClient, ctx: NativeCreateContext): Promise<void> {
  if (!ctx.privateDialogOk) {
    throw Object.assign(new Error("Создание доступно только в личном диалоге с ботом."), { http: 403 });
  }
  if (ctx.isLinkedStaff) {
    if (!ctx.staffUserId) {
      throw Object.assign(new Error("Профиль сотрудника не привязан."), { http: 403 });
    }
    const row = await client.query<{ status: string; role: string; email: string; full_name: string; phone: string | null }>(
      `SELECT status, role, email, full_name, phone FROM users WHERE id = $1::uuid`,
      [ctx.staffUserId],
    );
    const u = row.rows[0];
    if (!u || u.status !== "active") {
      throw Object.assign(new Error("Аккаунт недоступен."), { http: 403 });
    }
    const access = await loadAccessContext(ctx.staffUserId, u.role as UserDto["role"], client);
    const user: UserDto = {
      id: ctx.staffUserId,
      email: u.email,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role as UserDto["role"],
      status: "active",
      lastLoginAt: null,
    };
    if (!tanTrackerCanWrite(user, access)) {
      throw Object.assign(new Error("Создание передач недоступно для этой роли или режима."), { http: 403 });
    }
    let boundChat: string | undefined;
    if (ctx.channel === "telegram") {
      const bind = await client.query<{ telegram_chat_id: string }>(
        `SELECT telegram_chat_id FROM tanbot_telegram_accounts
         WHERE user_id = $1::uuid AND stopped_at IS NULL`,
        [ctx.staffUserId],
      );
      boundChat = bind.rows[0]?.telegram_chat_id;
    } else {
      const bind = await client.query<{ max_chat_id: string }>(
        `SELECT max_chat_id FROM tanbot_max_accounts
         WHERE user_id = $1::uuid AND stopped_at IS NULL`,
        [ctx.staffUserId],
      );
      boundChat = bind.rows[0]?.max_chat_id;
    }
    if (!boundChat || boundChat !== ctx.messengerChatId) {
      throw Object.assign(new Error("Чат не привязан к этому аккаунту."), { http: 403 });
    }
    return;
  }
  if (!ctx.personId) {
    throw Object.assign(new Error("Подтвердите номер телефона."), { http: 403 });
  }
  const bind = await client.query<{ id: string }>(
    `SELECT ep.id::text FROM tt_external_persons ep
     JOIN tt_external_person_verifications v ON v.person_id = ep.id AND v.channel = $2
     WHERE ep.id = $1::uuid AND v.messenger_user_id = $3::text
       AND v.messenger_chat_id = $4::text`,
    [ctx.personId, ctx.channel, ctx.messengerUserId.toString(), ctx.messengerChatId],
  );
  if (!bind.rows[0]) {
    throw Object.assign(new Error("Сессия не соответствует этому мессенджеру."), { http: 403 });
  }
}

export function assertDraftPersonRow(
  draft: { person_id: string | null },
  ctx: NativeCreateContext,
): void {
  if (ctx.isLinkedStaff) return;
  if (!ctx.personId || !draft.person_id || draft.person_id !== ctx.personId) {
    throw Object.assign(new Error("Черновик недоступен."), { http: 403 });
  }
}

export function assertDraftBoundToCaller(payload: NativeCreateDraftPayload, ctx: NativeCreateContext): void {
  if (payload.actor === "staff") {
    if (!ctx.isLinkedStaff || payload.staffUserId !== ctx.staffUserId) {
      throw Object.assign(new Error("Черновик недоступен."), { http: 403 });
    }
    return;
  }
  if (ctx.isLinkedStaff || payload.actor !== "external") {
    throw Object.assign(new Error("Черновик недоступен."), { http: 403 });
  }
}
