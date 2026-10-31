import type { PoolClient } from "pg";

const MAX_DISPLAY_NAME_LEN = 80;

/** Authenticated LK card, not a public recipient capability or a receipt-code issuing link. */
export function staffTransferLkDetailUrl(appOrigin: string, publicCode: string): string {
  const base = appOrigin.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("tt_screen", "detail");
  params.set("tt_id", publicCode);
  return `${base}/tan-tracker#?${params.toString()}`;
}

/** Strip control chars and collapse whitespace; never return phone/email-like raw identifiers. */
export function sanitizeNotificationDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > MAX_DISPLAY_NAME_LEN) {
    s = `${s.slice(0, MAX_DISPLAY_NAME_LEN - 1)}…`;
  }
  if (/^\+?\d[\d\s()-]{8,}$/.test(s)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export async function resolvePartyDisplayNameForNotification(
  client: PoolClient,
  partyId: string | null | undefined,
): Promise<string | null> {
  if (!partyId) return null;
  const row = await client.query<{ display_name: string | null; full_name: string | null; kind: string }>(
    `SELECT p.display_name, u.full_name, p.kind
     FROM tt_parties p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = $1::uuid
     LIMIT 1`,
    [partyId],
  );
  const r = row.rows[0];
  if (!r) return null;
  const candidate = r.kind === "user" ? r.full_name ?? r.display_name : r.display_name;
  return sanitizeNotificationDisplayName(candidate);
}

export type NotificationRouteSnapshot = {
  routeFromDisplayName?: string;
  routeToDisplayName?: string;
};

export async function buildNotificationRouteSnapshot(
  client: PoolClient,
  fromPartyId: string | null | undefined,
  toPartyId: string | null | undefined,
): Promise<NotificationRouteSnapshot> {
  const [fromName, toName] = await Promise.all([
    resolvePartyDisplayNameForNotification(client, fromPartyId ?? null),
    resolvePartyDisplayNameForNotification(client, toPartyId ?? null),
  ]);
  const out: NotificationRouteSnapshot = {};
  if (fromName) out.routeFromDisplayName = fromName;
  if (toName) out.routeToDisplayName = toName;
  return out;
}

export function formatTransferContextHeader(input: {
  publicCode: string;
  itemTitle: string;
  routeFromDisplayName?: string | null;
  routeToDisplayName?: string | null;
}): string {
  const item = sanitizeNotificationDisplayName(input.itemTitle) ?? "Передача";
  const code = input.publicCode.trim() || "—";
  const lines = [`Передача ${code}`, item, ""];
  const from = input.routeFromDisplayName ? sanitizeNotificationDisplayName(input.routeFromDisplayName) : null;
  const to = input.routeToDisplayName ? sanitizeNotificationDisplayName(input.routeToDisplayName) : null;
  if (from) lines.push(`От: ${from}`);
  if (to) lines.push(`Кому: ${to}`);
  if (from || to) lines.push("");
  return lines.join("\n").replace(/\n\n\n+/g, "\n\n").trimEnd();
}
