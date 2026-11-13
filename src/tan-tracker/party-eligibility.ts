import type { Pool, PoolClient } from "pg";
import type { AccessContext } from "../access/types";
import { normalizeRuPhoneE164, isUuid } from "./phone-normalize";
import {
  EmployeePhoneCollisionError,
  PhonePartyConflictError,
  resolveOrCreateGlobalExternalPartyByPhone,
} from "./phone-party-resolver";
import { loadTanTrackerTeamEmployeeGuids } from "./team-scope";
import { query } from "../db/pool";
import {
  isPendingUserPartyRef,
  resolveAdminRecipientRef,
  assertAdminSelectablePartyId,
  loadEligibleUserRowForRecipient,
  resolveEligibleUserRecipientPartyId,
  userIdFromPendingUserPartyRef,
} from "./recipient-catalog";
import { findStaffRecipientByPhone } from "./staff-phone-recipient";
import { PRIVATE_EXTERNAL_RECIPIENT_DISPLAY_NAME, loadContactAliases, saveContactAlias } from "./contact-aliases";
import { findPartyByUserId } from "./repository";

type Db = Pool | PoolClient;

async function loadTeamUserIds(teamEmployeeGuids: Set<string> | null): Promise<string[]> {
  if (!teamEmployeeGuids || teamEmployeeGuids.size === 0) return [];
  const guids = [...teamEmployeeGuids];
  const res = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id::text FROM user_onec_employee_links
     WHERE revoked_at IS NULL AND lower(employee_id::text) = ANY($1::text[])`,
    [guids.map((g) => g.toLowerCase())],
  );
  return res.rows.map((r) => r.user_id);
}

export async function assertRecipientRefEligible(
  client: Db,
  access: AccessContext,
  userId: string,
  ref: string,
): Promise<void> {
  const pendingUserId = userIdFromPendingUserPartyRef(ref);
  if (pendingUserId) {
    await loadEligibleUserRowForRecipient(client, pendingUserId, userId);
    if (access.role !== "admin") {
      throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
    }
    return;
  }
  await assertPartyEligibleAsRecipient(client, access, userId, ref);
}

export async function assertPartyEligibleAsRecipient(
  client: Db,
  access: AccessContext,
  userId: string,
  partyId: string,
): Promise<void> {
  if (!isUuid(partyId)) {
    throw Object.assign(new Error("Некорректный получатель."), { http: 400 });
  }
  if (access.role === "director") {
    const row = await client.query(`SELECT id FROM tt_parties WHERE id = $1::uuid`, [partyId]);
    if (!row.rowCount) throw Object.assign(new Error("Получатель не найден."), { http: 404 });
    return;
  }
  if (access.role === "admin") {
    await assertAdminSelectablePartyId(client, userId, partyId);
    return;
  }
  const teamGuids = await loadTanTrackerTeamEmployeeGuids({ ...access, userId, role: access.role });
  const teamUserIds = await loadTeamUserIds(teamGuids);
  const employeeId = access.employeeId;
  const res = await client.query<{ ok: boolean }>(
    `
      SELECT TRUE AS ok FROM tt_parties p
      WHERE p.id = $1::uuid
        AND (
          p.kind = 'external'
          OR (
            p.kind = 'user'
            AND p.user_id IS NOT NULL
            AND (
              (cardinality($3::uuid[]) > 0 AND p.user_id = ANY($3::uuid[]))
              OR (
                $4::uuid IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM user_onec_employee_links actor_link
                  JOIN onec_wholesale_employee_team_memberships tm
                    ON tm.guid_manager = actor_link.employee_id
                  JOIN onec_wholesale_employee_team_memberships peer
                    ON peer.guid_team = tm.guid_team
                  JOIN user_onec_employee_links peer_link
                    ON peer_link.employee_id = peer.guid_manager
                   AND peer_link.revoked_at IS NULL
                  WHERE actor_link.user_id = $2::uuid
                    AND actor_link.revoked_at IS NULL
                    AND peer_link.user_id = p.user_id
                )
              )
            )
          )
        )
      LIMIT 1
    `,
    [partyId, userId, teamUserIds, employeeId],
  );
  if (!res.rowCount) {
    throw Object.assign(new Error("Получатель недоступен для этой передачи."), { http: 403 });
  }
}

export type ExternalRecipientInput = { name: string; phone: string };

function normalizeExternalRecipientInput(input: ExternalRecipientInput): { name: string; phoneE164: string } {
  const name = input.name.trim();
  if (!name) {
    throw Object.assign(new Error("Введите имя получателя."), { http: 400 });
  }
  const phoneE164 = normalizeRuPhoneE164(input.phone);
  if (!phoneE164) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }
  return { name, phoneE164 };
}

export async function resolveExternalRecipientPartyId(
  client: Db,
  userId: string,
  input: ExternalRecipientInput,
): Promise<string> {
  const { name, phoneE164 } = normalizeExternalRecipientInput(input);
  try {
    return await resolveOrCreateGlobalExternalPartyByPhone(client, {
      phoneE164,
      displayName: name,
      createdByUserId: userId,
    });
  } catch (err) {
    if (err instanceof PhonePartyConflictError || err instanceof EmployeePhoneCollisionError) {
      throw Object.assign(err, { http: err.http });
    }
    throw err;
  }
}

/** Native external actor: global phone party without staff provenance (no rename on reuse). */
export async function resolveExternalRecipientPartyIdForExternalActor(
  client: Db,
  input: ExternalRecipientInput,
): Promise<string> {
  const { name, phoneE164 } = normalizeExternalRecipientInput(input);
  try {
    return await resolveOrCreateGlobalExternalPartyByPhone(client, {
      phoneE164,
      displayName: name,
      createdByUserId: null,
    });
  } catch (err) {
    if (err instanceof PhonePartyConflictError || err instanceof EmployeePhoneCollisionError) {
      throw Object.assign(err, { http: err.http });
    }
    throw err;
  }
}

export async function resolveRecipientPartyId(
  client: Db,
  access: AccessContext,
  userId: string,
  partyId: string | undefined,
  external: ExternalRecipientInput | undefined,
): Promise<string> {
  if (external && (external.name || external.phone)) {
    const { phoneE164 } = normalizeExternalRecipientInput(external);
    const staff = await findStaffRecipientByPhone(client, phoneE164);
    if (staff) {
      // A phone-addressed internal handoff may cross teams; arbitrary UUID picks
      // retain their existing scope checks below. No role/client access is granted.
      return resolveEligibleUserRecipientPartyId(client, userId, staff.id);
    }
    // An explicitly addressed phone may reuse a global external regardless of creator.
    // The resolver checks canonical mappings and employee/duplicate conflicts.
    // Creator/scope checks remain below for opaque party-ID selections.
    return resolveExternalRecipientPartyId(client, userId, {
      ...external, name: PRIVATE_EXTERNAL_RECIPIENT_DISPLAY_NAME,
    });
  }
  const resolved = String(partyId ?? "").trim();
  if (!resolved) {
    throw Object.assign(new Error("Выберите конечного получателя."), { http: 400 });
  }
  if (access.role === "admin") {
    const authorized = await resolveAdminRecipientRef(client, access, userId, resolved);
    return resolveAuthorizedSavedRecipient(client, userId, authorized);
  }
  if (isPendingUserPartyRef(resolved)) {
    throw Object.assign(new Error("Выберите получателя из каталога или добавьте новый контакт."), {
      http: 400,
    });
  }
  if (!isUuid(resolved)) {
    throw Object.assign(new Error("Выберите получателя из каталога или добавьте новый контакт."), {
      http: 400,
    });
  }
  await assertPartyEligibleAsRecipient(client, access, userId, resolved);
  return resolveAuthorizedSavedRecipient(client, userId, resolved);
}

/** Recheck a saved external contact only AFTER the original UUID passes its scope guard.
 * Applies to this new assignment, never to existing transfers or external history.
 */
async function resolveAuthorizedSavedRecipient(client: Db, actorUserId: string, partyId: string): Promise<string> {
  const source = (await client.query<{ phone_e164: string | null }>(
    `SELECT phone_e164 FROM tt_parties WHERE id=$1::uuid AND kind='external'`, [partyId],
  )).rows[0];
  const phone = source?.phone_e164 && normalizeRuPhoneE164(source.phone_e164);
  if (!phone) return partyId;
  const staff = await findStaffRecipientByPhone(client, phone);
  if (!staff) return partyId;
  const targetId = await resolveEligibleUserRecipientPartyId(client, actorUserId, staff.id);
  const viewer = await findPartyByUserId(client, actorUserId);
  if (viewer) {
    const alias = (await loadContactAliases(client, viewer.id)).get(partyId);
    if (alias) await saveContactAlias(client, viewer.id, actorUserId, targetId, alias);
  }
  return targetId;
}
