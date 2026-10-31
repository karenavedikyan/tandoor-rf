import type { PoolClient } from "pg";
import { loadAccessContext } from "../../access/context";
import { listEligibleStaffForExternalParty } from "../../tan-tracker/external-request/intake-handlers";
import {
  assertAdminSelectablePartyId,
  listTanTrackerRecipientCatalog,
  userIdFromPendingUserPartyRef,
} from "../../tan-tracker/recipient-catalog";
import { assertPartyEligibleAsRecipient } from "../../tan-tracker/party-eligibility";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
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

async function staffInternalCatalog(
  client: PoolClient,
  staffUserId: string,
): Promise<RecipientSearchHit[]> {
  const catalog = await listTanTrackerRecipientCatalog(client, staffUserId);
  const access = await loadAccessContext(staffUserId, undefined, client);
  const out: RecipientSearchHit[] = [];
  for (const c of catalog) {
    try {
      await assertPartyEligibleAsRecipient(client, access, staffUserId, c.id);
      out.push({ ref: c.id, fullName: c.name, phone: c.phone || null });
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
  const internal = await staffInternalCatalog(client, staffUserId);
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
  const pendingUser = userIdFromPendingUserPartyRef(ref);
  if (pendingUser) {
    const catalog = await staffInternalCatalog(client, staffUserId);
    return catalog.find((c) => c.ref === ref) ?? null;
  }
  try {
    await assertAdminSelectablePartyId(client, staffUserId, ref);
    const row = await client.query<{ display_name: string; phone_e164: string | null }>(
      `SELECT display_name, phone_e164 FROM tt_parties WHERE id = $1::uuid`,
      [ref],
    );
    const p = row.rows[0];
    if (!p) return null;
    return { ref, fullName: p.display_name, phone: p.phone_e164 };
  } catch {
    return null;
  }
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
    const u = await client.query<{ phone: string | null }>(`SELECT phone FROM users WHERE id = $1::uuid`, [
      row.userId,
    ]);
    const p = u.rows[0]?.phone ? normalizeRuPhoneE164(u.rows[0].phone) : null;
    if (p === phoneE164) return row.userId;
  }
  return null;
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
    return {
      kind: "render",
      payload: {
        ...payload,
        recipientSearchQuery: trimmed,
        recipientExternal: { name: "", phone },
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
        recipientSearchQuery: undefined,
        recipientPage: 0,
        eligibleRecipients: [],
        recipientExternal: { name: trimmed, phone: "" },
        recipientNameManual: true,
      },
      step: "recipient_ext_name",
    };
  }
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
  const party = await client.query<{ party_id: string }>(
    `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`,
    [ctx.personId],
  );
  const partyId = party.rows[0]?.party_id;
  if (!partyId) {
    return { kind: "render", payload, step: "recipient" };
  }
  const staffUserId = await matchExternalActorStaffByPhone(client, partyId, phone);
  if (!staffUserId) {
    return {
      kind: "hint",
      message: externalUnavailableMessage(),
      payload: { ...payload, recipientSearchQuery: trimmed, eligibleRecipients: [], recipientPage: 0 },
      step: "recipient",
    };
  }
  return {
    kind: "render",
    payload: {
      ...payload,
      recipientUserId: staffUserId,
      recipientPartyId: undefined,
      recipientDisplayName: externalSummaryDisplayName(phone),
      recipientSearchQuery: undefined,
      eligibleRecipients: [],
    },
    step: "due",
  };
}
