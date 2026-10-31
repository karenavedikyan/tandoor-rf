const PREFIX = "nc";

export type NativeCreateCallbackAction =
  | "confirm"
  | "cancel"
  | "back"
  | "edit"
  | "photo_skip"
  | "photo_next"
  | "photo_view"
  | "comment_skip"
  | "recipient"
  | "recipient_page"
  | "recipient_ext"
  | "due"
  | "restart"
  | "menu"
  | "menu_create"
  | "menu_my";

const ACTION_CODE: Record<NativeCreateCallbackAction, string> = {
  confirm: "1",
  cancel: "2",
  back: "3",
  edit: "4",
  photo_skip: "5",
  photo_next: "6",
  recipient: "7",
  recipient_page: "8",
  due: "9",
  restart: "d",
  menu: "0",
  comment_skip: "a",
  recipient_ext: "b",
  photo_view: "c",
  menu_create: "e",
  menu_my: "f",
};

const CODE_ACTION: Record<string, NativeCreateCallbackAction> = Object.fromEntries(
  Object.entries(ACTION_CODE).map(([k, v]) => [v, k as NativeCreateCallbackAction]),
) as Record<string, NativeCreateCallbackAction>;

export function draftIdToHex32(draftId: string): string | null {
  const hex = draftId.replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(hex)) return null;
  return hex;
}

export function buildNativeCreateCallback(
  action: NativeCreateCallbackAction,
  draftId: string,
  revision: number,
  arg?: string,
): string | null {
  const hex = draftIdToHex32(draftId);
  if (!hex) return null;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  const code = ACTION_CODE[action];
  const parts = [PREFIX, code, hex, String(revision)];
  if (arg != null && arg !== "") {
    if (!/^[a-z0-9._-]{1,16}$/i.test(arg)) return null;
    parts.push(arg);
  }
  const payload = parts.join(":");
  if (Buffer.byteLength(payload, "utf8") > 64) return null;
  return payload;
}

export type ParsedNativeCreateCallback = {
  action: NativeCreateCallbackAction;
  draftIdHex: string;
  revision: number;
  arg?: string;
};

export function parseNativeCreateCallback(data: string): ParsedNativeCreateCallback | null {
  if (Buffer.byteLength(data, "utf8") > 64) return null;
  const parts = data.split(":");
  if (parts.length < 4 || parts[0] !== PREFIX) return null;
  const action = CODE_ACTION[parts[1]!];
  if (!action) return null;
  const draftIdHex = parts[2]!.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(draftIdHex)) return null;
  const revision = Number(parts[3]);
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  if (parts.length > 5) return null;
  const arg = parts[4]?.trim() || undefined;
  if (arg && !/^[a-z0-9._-]{1,16}$/i.test(arg)) return null;
  return { action, draftIdHex, revision, arg };
}

export function draftIdMatchesHex(fullId: string, hex: string): boolean {
  const normalized = draftIdToHex32(fullId);
  return normalized != null && normalized === hex.toLowerCase();
}
