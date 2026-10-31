const PREFIX = "nc:";

export type NativeCreateCallbackAction =
  | "confirm"
  | "cancel"
  | "back"
  | "edit"
  | "photo_skip"
  | "photo_next"
  | "recipient"
  | "recipient_page"
  | "due"
  | "restart"
  | "menu";

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
};

const CODE_ACTION: Record<string, NativeCreateCallbackAction> = Object.fromEntries(
  Object.entries(ACTION_CODE).map(([k, v]) => [v, k as NativeCreateCallbackAction]),
) as Record<string, NativeCreateCallbackAction>;

export function draftShortId(draftId: string): string {
  return draftId.replace(/-/g, "").slice(0, 10);
}

export function buildNativeCreateCallback(
  action: NativeCreateCallbackAction,
  draftId: string,
  revision: number,
  arg?: string,
): string {
  const short = draftShortId(draftId);
  const rev = Math.max(0, Math.min(99, revision));
  const base = `${PREFIX}${ACTION_CODE[action]}:${short}:${rev}`;
  const withArg = arg != null && arg !== "" ? `${base}:${arg}` : base;
  return withArg.slice(0, 64);
}

export type ParsedNativeCreateCallback = {
  action: NativeCreateCallbackAction;
  draftShortId: string;
  revision: number;
  arg?: string;
};

export function parseNativeCreateCallback(data: string): ParsedNativeCreateCallback | null {
  if (!data.startsWith(PREFIX)) return null;
  const parts = data.slice(PREFIX.length).split(":");
  if (parts.length < 3) return null;
  const action = CODE_ACTION[parts[0]!];
  if (!action) return null;
  const draftShortId = parts[1]!.trim();
  if (!/^[a-f0-9]{10}$/i.test(draftShortId)) return null;
  const revision = Number(parts[2]);
  if (!Number.isInteger(revision) || revision < 0 || revision > 99) return null;
  const arg = parts[3]?.trim() || undefined;
  return { action, draftShortId, revision, arg };
}

export function draftIdMatchesShort(fullId: string, short: string): boolean {
  return draftShortId(fullId).toLowerCase() === short.toLowerCase();
}
