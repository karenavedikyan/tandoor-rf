import type { Pool, PoolClient } from "pg";
import type { AccessContext } from "../access/types";
import { isTanTrackerParticipantRole } from "../shared/lk-role-capabilities";
import { isUuid } from "./phone-normalize";
import { ensurePartyForUserOnWrite } from "./repository";
import type { TanTrackerContactDto } from "./types";

type Db = Pool | PoolClient;

/** Bootstrap contact id when an eligible user has no tt_parties row yet. */
export const TT_PENDING_USER_PARTY_PREFIX = "tt-user:";

export function isPendingUserPartyRef(ref: string): boolean {
  return ref.startsWith(TT_PENDING_USER_PARTY_PREFIX);
}

export function userIdFromPendingUserPartyRef(ref: string): string | null {
  if (!isPendingUserPartyRef(ref)) return null;
  const id = ref.slice(TT_PENDING_USER_PARTY_PREFIX.length).trim();
  return isUuid(id) ? id : null;
}

export async function listTanTrackerRecipientCatalog(
  client: Db,
  excludeUserId: string,
): Promise<TanTrackerContactDto[]> {
  const res = await client.query<{
    user_id: string;
    full_name: string;
    phone: string | null;
    party_id: string | null;
    employee_id: string | null;
  }>(
    `SELECT u.id::text AS user_id, u.full_name, u.phone, p.id::text AS party_id, uoel.employee_id::text AS employee_id
     FROM users u
     LEFT JOIN tt_parties p ON p.user_id = u.id AND p.kind = 'user'
     LEFT JOIN user_onec_employee_links uoel ON uoel.user_id = u.id AND uoel.revoked_at IS NULL
     WHERE u.status = 'active'
       AND u.id <> $1::uuid
       AND u.role NOT IN ('marketer', 'analyst', 'category_manager')
     ORDER BY u.full_name ASC`,
    [excludeUserId],
  );
  return res.rows.map((row) => ({
    id: row.party_id ?? `${TT_PENDING_USER_PARTY_PREFIX}${row.user_id}`,
    name: row.full_name,
    phone: row.phone ?? "",
    kind: "user",
    employeeId: row.employee_id,
  }));
}

export function mergeTanTrackerContactLists(
  scoped: TanTrackerContactDto[],
  catalog: TanTrackerContactDto[],
): TanTrackerContactDto[] {
  const byUserKey = new Map<string, TanTrackerContactDto>();
  for (const c of scoped) {
    if (c.kind === "user" && isPendingUserPartyRef(c.id)) {
      byUserKey.set(c.id.slice(TT_PENDING_USER_PARTY_PREFIX.length), c);
    } else if (c.kind === "user") {
      byUserKey.set(`party:${c.id}`, c);
    }
  }
  for (const c of catalog) {
    const uid = isPendingUserPartyRef(c.id) ? c.id.slice(TT_PENDING_USER_PARTY_PREFIX.length) : null;
    if (uid) {
      if (!byUserKey.has(uid)) byUserKey.set(uid, c);
      continue;
    }
    if (!byUserKey.has(`party:${c.id}`)) byUserKey.set(`party:${c.id}`, c);
  }
  const externals = scoped.filter((c) => c.kind === "external");
  const mergedUsers = [...byUserKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return [...mergedUsers, ...externals];
}

async function loadEligibleUserRow(client: Db, userId: string, actorUserId: string) {
  const res = await client.query<{ id: string; full_name: string; phone: string | null; role: string; status: string }>(
    `SELECT id::text, full_name, phone, role, status FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) {
    throw Object.assign(new Error("Получатель не найден."), { http: 404 });
  }
  if (row.status !== "active") {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
  if (!isTanTrackerParticipantRole(row.role)) {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
  if (row.id === actorUserId) {
    throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
  }
  return row;
}

/** Materialize tt_parties for an eligible user on explicit transfer write. */
export async function resolveEligibleUserRecipientPartyId(
  client: Db,
  actorUserId: string,
  targetUserId: string,
): Promise<string> {
  const user = await loadEligibleUserRow(client, targetUserId, actorUserId);
  const party = await ensurePartyForUserOnWrite(client, user.id, user.full_name, user.phone);
  return party.id;
}

export async function assertAdminSelectablePartyId(
  client: Db,
  actorUserId: string,
  partyId: string,
): Promise<void> {
  const res = await client.query<{ kind: string; user_id: string | null; created_by_user_id: string | null }>(
    `SELECT kind, user_id::text, created_by_user_id::text FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
    [partyId],
  );
  const row = res.rows[0];
  if (!row) {
    throw Object.assign(new Error("Получатель не найден."), { http: 404 });
  }
  if (row.kind === "external") {
    if (row.created_by_user_id !== actorUserId) {
      throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
    }
    return;
  }
  if (row.kind === "user" && row.user_id) {
    await loadEligibleUserRow(client, row.user_id, actorUserId);
    return;
  }
  throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
}

export async function resolveAdminRecipientRef(
  client: Db,
  access: AccessContext,
  actorUserId: string,
  ref: string,
): Promise<string> {
  if (access.role !== "admin") {
    throw Object.assign(new Error("Внутренняя ошибка разрешений."), { http: 500 });
  }
  const pendingUserId = userIdFromPendingUserPartyRef(ref);
  if (pendingUserId) {
    return resolveEligibleUserRecipientPartyId(client, actorUserId, pendingUserId);
  }
  if (!isUuid(ref)) {
    throw Object.assign(new Error("Выберите получателя из каталога или добавьте новый контакт."), { http: 400 });
  }
  await assertAdminSelectablePartyId(client, actorUserId, ref);
  return ref;
}
