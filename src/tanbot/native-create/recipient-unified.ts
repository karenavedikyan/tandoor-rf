import type { PoolClient } from "pg";
import { loadAccessContext } from "../../access/context";
import { listEligibleStaffForExternalParty } from "../../tan-tracker/external-request/intake-handlers";
import {
  isPendingUserPartyRef,
  listTanTrackerRecipientCatalog,
  userIdFromPendingUserPartyRef,
} from "../../tan-tracker/recipient-catalog";
import { assertRecipientRefEligible } from "../../tan-tracker/party-eligibility";
import type { AccessContext } from "../../access/types";
import { isUuid, normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
import type { NativeCreateContext } from "./engine";
import type { NativeCreateDraftPayload } from "./draft-scope";

export const RECIPIENT_PAGE_SIZE = 5;
export const RECIPIENT_MIN_NAME_QUERY_LEN = 2;

export type RecipientSearchHit = { ref: string; fullName: string; phone?: string | null };

export function staffRecipientIntroPrompt(): string {
  return "Кому передаёте?\nВведите имя, фамилию или телефон либо отправьте контакт.";
}

export function externalRecipientIntroPrompt(): string {
  return "Кому передаёте? Укажите телефон получателя или отправьте контакт.";
}

export function recipientStepPrompt(payload: NativeCreateDraftPayload, actor: "staff" | "external"): string {
  if (actor === "external") return externalRecipientIntroPrompt();
  const q = payload.recipientSearchQuery?.trim();
  if (!q) return staffRecipientIntroPrompt();
  const hits = payload.eligibleRecipients?.length ?? 0;
  if (hits > 0) {
    return `Кому передаёте? Совпадения по «${q.slice(0, 64)}». Выберите кнопкой или уточните запрос.`;
  }
  return `${staffRecipientIntroPrompt()}\n\nНичего не найдено. Введите телефон или отправьте контакт.`;
}

export function looksPhoneLike(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7;
}

export function normalizeRecipientQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}

function nameMatchesQuery(fullName: string, query: string): boolean {
  const name = fullName.toLowerCase();
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => name.includes(p));
}

async function staffAccessibleExternalParties(
  client: PoolClient,
  staffUserId: string,
): Promise<Array<{ id: string; display_name: string; phone_e164: string | null }>> {
  const res = await client.query<{ id: string; display_name: string; phone_e164: string | null }>(
    `SELECT id::text, display_name, phone_e164
     FROM tt_parties
     WHERE kind = 'external' AND created_by_user_id = $1::uuid
     ORDER BY display_name ASC`,
    [staffUserId],
  );
  return res.rows;
}

async function phoneE164ForCatalogUser(client: PoolClient, userId: string): Promise<string | null> {
  const row = await client.query<{ phone: string | null; phone_e164: string | null }>(
    `SELECT u.phone, p.phone_e164
     FROM users u
     LEFT JOIN tt_parties p ON p.user_id = u.id AND p.kind = 'user'
     WHERE u.id = $1::uuid
     LIMIT 1`,
    [userId],
  );
  const raw = row.rows[0]?.phone?.trim() || row.rows[0]?.phone_e164?.trim() || "";
  return raw ? normalizeRuPhoneE164(raw) : null;
}

async function phoneForCatalogEntry(
  client: PoolClient,
  entry: { id: string; phone: string },
): Promise<string | null> {
  const fromDto = entry.phone?.trim() ? normalizeRuPhoneE164(entry.phone) : null;
  if (fromDto) return fromDto;
  const pending = userIdFromPendingUserPartyRef(entry.id);
  if (pending) return phoneE164ForCatalogUser(client, pending);
  if (isUuid(entry.id)) {
    const row = await client.query<{ phone: string | null; phone_e164: string | null }>(
      `SELECT u.phone, p.phone_e164
       FROM tt_parties p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1::uuid AND p.kind = 'user'
       LIMIT 1`,
      [entry.id],
    );
    const raw = row.rows[0]?.phone?.trim() || row.rows[0]?.phone_e164?.trim() || "";
    return raw ? normalizeRuPhoneE164(raw) : null;
  }
  return null;
}

async function staffInternalCatalog(
  client: PoolClient,
  staffUserId: string,
  access: AccessContext,
): Promise<RecipientSearchHit[]> {
  const catalog = await listTanTrackerRecipientCatalog(client, staffUserId);
  const out: RecipientSearchHit[] = [];
  for (const c of catalog) {
    try {
      await assertRecipientRefEligible(client, access, staffUserId, c.id);
      const phone = await phoneForCatalogEntry(client, c);
      out.push({ ref: c.id, fullName: c.name, phone });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function searchStaffRecipientHits(
  client: PoolClient,
  staffUserId: string,
  queryRaw: string,
): Promise<RecipientSearchHit[]> {
  const query = normalizeRecipientQuery(queryRaw);
  if (query.length < RECIPIENT_MIN_NAME_QUERY_LEN) return [];

  const phone = normalizeRuPhoneE164(query);
  const access = await loadAccessContext(staffUserId, undefined, client);
  const internal = await staffInternalCatalog(client, staffUserId, access);
  const external = await staffAccessibleExternalParties(client, staffUserId);
  const hits: RecipientSearchHit[] = [];

  if (phone) {
    for (const c of internal) {
      const p = c.phone ? normalizeRuPhoneE164(c.phone) : null;
      if (p === phone) hits.push(c);
    }
    for (const e of external) {
      const p = e.phone_e164 ? normalizeRuPhoneE164(e.phone_e164) : null;
      if (p === phone) hits.push({ ref: e.id, fullName: e.display_name, phone: e.phone_e164 });
    }
    return dedupeHits(hits);
  }

  for (const c of internal) {
    if (nameMatchesQuery(c.fullName, query)) hits.push(c);
  }
  for (const e of external) {
    if (nameMatchesQuery(e.display_name, query)) {
      hits.push({ ref: e.id, fullName: e.display_name, phone: e.phone_e164 });
    }
  }
  return dedupeHits(hits);
}

function dedupeHits(hits: RecipientSearchHit[]): RecipientSearchHit[] {
  const seen = new Set<string>();
  const out: RecipientSearchHit[] = [];
  for (const h of hits) {
    if (seen.has(h.ref)) continue;
    seen.add(h.ref);
    out.push(h);
  }
  return out;
}

export async function findExistingExternalByPhone(
  client: PoolClient,
  staffUserId: string,
  phoneE164: string,
): Promise<{ partyId: string; name: string; phone: string } | null> {
  const row = await client.query<{ id: string; display_name: string; phone_e164: string }>(
    `SELECT id::text, display_name, phone_e164
     FROM tt_parties
     WHERE kind = 'external' AND created_by_user_id = $1::uuid AND phone_e164 = $2
     LIMIT 1`,
    [staffUserId, phoneE164],
  );
  const hit = row.rows[0];
  if (!hit) return null;
  return { partyId: hit.id, name: hit.display_name, phone: hit.phone_e164 };
}

export async function revalidateStaffRecipientPick(
  client: PoolClient,
  staffUserId: string,
  ref: string,
): Promise<RecipientSearchHit | null> {
  const roleRow = await client.query<{ role: string }>(`SELECT role FROM users WHERE id = $1::uuid`, [staffUserId]);
  const access = await loadAccessContext(staffUserId, roleRow.rows[0]?.role as import("../../shared/user").UserRole, client);
  try {
    await assertRecipientRefEligible(client, access, staffUserId, ref);
  } catch {
    return null;
  }
  const pendingUser = userIdFromPendingUserPartyRef(ref);
  if (pendingUser) {
    const u = await client.query<{ full_name: string; phone: string | null }>(
      `SELECT full_name, phone FROM users WHERE id = $1::uuid`,
      [pendingUser],
    );
    const row = u.rows[0];
    if (!row) return null;
    const phone = await phoneE164ForCatalogUser(client, pendingUser);
    return { ref, fullName: row.full_name, phone };
  }
  if (isPendingUserPartyRef(ref)) return null;
  const row = await client.query<{ display_name: string; phone_e164: string | null; kind: string }>(
    `SELECT display_name, phone_e164, kind FROM tt_parties WHERE id = $1::uuid`,
    [ref],
  );
  const p = row.rows[0];
  if (!p) return null;
  return { ref, fullName: p.display_name, phone: p.phone_e164 };
}

export async function revalidateExternalStaffPick(
  client: PoolClient,
  externalPartyId: string,
  staffUserId: string,
): Promise<boolean> {
  const eligible = await listEligibleStaffForExternalParty(client, externalPartyId);
  return eligible.some((e) => e.userId === staffUserId);
}

export function hitsToEligibleRecipients(hits: RecipientSearchHit[]): Array<{ userId: string; fullName: string }> {
  return hits.map((h) => ({ userId: h.ref, fullName: h.fullName }));
}

export function filteredRecipientHits(payload: NativeCreateDraftPayload): RecipientSearchHit[] {
  const all = payload.eligibleRecipients ?? [];
  return all.map((c) => ({ ref: c.userId, fullName: c.fullName }));
}

export function externalUnavailableMessage(): string {
  return "Получатель недоступен. Проверьте телефон или обратитесь к менеджеру.";
}

export async function matchExternalActorStaffByPhone(
  client: PoolClient,
  externalPartyId: string,
  phoneE164: string,
): Promise<string | null> {
  const eligible = await listEligibleStaffForExternalParty(client, externalPartyId);
  for (const row of eligible) {
    const p = await phoneE164ForCatalogUser(client, row.userId);
    if (p === phoneE164) return row.userId;
  }
  return null;
}

export function externalRecipientNamePrompt(payload: NativeCreateDraftPayload): string {
  const phone = payload.externalRecipientPhone?.trim();
  if (payload.recipientExtAwaitNameConfirm && payload.recipientContactSuggestedName?.trim()) {
    return (
      `Имя получателя для заявки.\n` +
      (phone ? `Телефон: ${phone}\n` : "") +
      `Предложено из контакта: ${payload.recipientContactSuggestedName.trim()}\n\n` +
      `Подтвердите или введите другое имя текстом.`
    );
  }
  return (
    "Укажите имя получателя для заявки.\n" +
    (phone ? `Телефон: ${phone}\n` : "") +
    "Введите имя текстом или подтвердите предложенное из контакта."
  );
}

export function externalSummaryDisplayName(phoneE164: string): string {
  return `Получатель (${phoneE164})`;
}

export function staffSingleCharHint(): string {
  return "Введите ещё символ для поиска (имя от 2 букв) или укажите телефон.";
}

export function invalidPhoneHint(): string {
  return "Не удалось распознать телефон. Введите 10 цифр после +7 или отправьте контакт.";
}

export type RecipientTextHandleResult =
  | { kind: "render"; payload: NativeCreateDraftPayload; step: string }
  | { kind: "hint"; message: string; payload: NativeCreateDraftPayload; step: string };

export async function handleStaffRecipientSearchText(
  client: PoolClient,
  ctx: NativeCreateContext,
  payload: NativeCreateDraftPayload,
  text: string,
): Promise<RecipientTextHandleResult> {
  const trimmed = normalizeRecipientQuery(text);
  if (!trimmed) {
    return { kind: "render", payload, step: "recipient" };
  }
  if (trimmed.length < RECIPIENT_MIN_NAME_QUERY_LEN && !looksPhoneLike(trimmed)) {
    return {
      kind: "hint",
      message: staffSingleCharHint(),
      payload: { ...payload, recipientSearchQuery: trimmed, recipientPage: 0, eligibleRecipients: [] },
      step: "recipient",
    };
  }

  const phone = normalizeRuPhoneE164(trimmed);
  if (looksPhoneLike(trimmed) && !phone) {
    return {
      kind: "hint",
      message: invalidPhoneHint(),
      payload: { ...payload, recipientSearchQuery: trimmed, recipientPage: 0, eligibleRecipients: [] },
      step: "recipient",
    };
  }

  if (phone && ctx.staffUserId) {
    const existing = await findExistingExternalByPhone(client, ctx.staffUserId, phone);
    if (existing) {
      const hits = [{ ref: existing.partyId, fullName: `${existing.name} (${existing.phone})`, phone: existing.phone }];
      return {
        kind: "render",
        payload: {
          ...payload,
          recipientSearchQuery: trimmed,
          recipientPage: 0,
          eligibleRecipients: hitsToEligibleRecipients(hits),
        },
        step: "recipient",
      };
    }
    const internal = await searchStaffRecipientHits(client, ctx.staffUserId, trimmed);
    if (internal.length) {
      return {
        kind: "render",
        payload: {
          ...payload,
          recipientSearchQuery: trimmed,
          recipientPage: 0,
          eligibleRecipients: hitsToEligibleRecipients(internal),
        },
        step: "recipient",
      };
    }
    const pendingName = payload.recipientPendingExternalName?.trim() ?? "";
    delete payload.recipientPendingExternalName;
    return {
      kind: "render",
      payload: {
        ...payload,
        recipientSearchQuery: trimmed,
        recipientExternal: { name: pendingName, phone },
        recipientNameManual: Boolean(pendingName),
        recipientPage: 0,
        eligibleRecipients: [],
      },
      step: "recipient_ext_name",
    };
  }

  if (!ctx.staffUserId) {
    return { kind: "render", payload, step: "recipient" };
  }
  const hits = await searchStaffRecipientHits(client, ctx.staffUserId, trimmed);
  if (hits.length === 0) {
    return {
      kind: "render",
      payload: {
        ...payload,
        recipientSearchQuery: trimmed,
        recipientPage: 0,
        eligibleRecipients: [],
        recipientPendingExternalName: trimmed,
      },
      step: "recipient",
    };
  }
  return {
    kind: "render",
    payload: {
      ...payload,
      recipientSearchQuery: trimmed,
      recipientPage: 0,
      eligibleRecipients: hitsToEligibleRecipients(hits),
      recipientPendingExternalName: undefined,
    },
    step: "recipient",
  };
}

export async function handleExternalRecipientPhoneText(
  client: PoolClient,
  ctx: NativeCreateContext,
  payload: NativeCreateDraftPayload,
  text: string,
): Promise<RecipientTextHandleResult> {
  const trimmed = normalizeRecipientQuery(text);
  if (!trimmed) {
    return { kind: "render", payload, step: "recipient" };
  }
  if (!looksPhoneLike(trimmed)) {
    return {
      kind: "hint",
      message: `${externalRecipientIntroPrompt()}\n\nНичего не найдено. Введите телефон или отправьте контакт.`,
      payload: { ...payload, recipientSearchQuery: trimmed, eligibleRecipients: [], recipientPage: 0 },
      step: "recipient",
    };
  }
  const phone = normalizeRuPhoneE164(trimmed);
  if (!phone) {
    return {
      kind: "hint",
      message: invalidPhoneHint(),
      payload: { ...payload, recipientSearchQuery: trimmed, eligibleRecipients: [], recipientPage: 0 },
      step: "recipient",
    };
  }
  if (!ctx.personId) {
    return { kind: "render", payload, step: "recipient" };
  }
  return {
    kind: "render",
    payload: {
      ...payload,
      externalRecipientPhone: phone,
      recipientUserId: undefined,
      recipientPartyId: undefined,
      recipientDisplayName: undefined,
      recipientSearchQuery: undefined,
      eligibleRecipients: [],
      recipientPage: 0,
    },
    step: "recipient_ext_name",
  };
}

export async function resolveExternalIntakeStaffUserId(
  client: PoolClient,
  externalPartyId: string,
  phoneE164: string,
): Promise<string | null> {
  return matchExternalActorStaffByPhone(client, externalPartyId, phoneE164);
}
