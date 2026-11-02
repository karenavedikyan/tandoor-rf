import type { MaxInlineButton } from "./delivery-transport";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../tanbot/native-create/menu-sentinel";
import { parseReceiptEntryCallback } from "../tanbot/receipt-entry-callback";

/** Navigation only: opens the home screen, not the compact menu panel. */
export const MAX_MAIN_MENU_CALLBACK = buildNativeCreateCallback("menu_home", NATIVE_MENU_DRAFT_HEX, 1)!;

function isMenuNavigationButton(button: MaxInlineButton): boolean {
  const label = button.text.trim().toLowerCase();
  if (label === "меню" || label === "к основным действиям") return true;
  if (button.type !== "callback") return false;
  const parsed = parseNativeCreateCallback(button.payload ?? "");
  return parsed?.action === "menu" || parsed?.action === "menu_home";
}

/** Exactly one footer when inline navigation lacks its own path to menu/home. */
export function withMaxMainMenuButton(buttons?: MaxInlineButton[][]): MaxInlineButton[][] {
  const source = (buttons ?? []).map((row) => [...row]).filter((row) => row.length > 0);
  const flat = source.flat();
  if (flat.length === 2 && flat.every(button => button.type === "callback")) {
    const actions = flat.map(button => parseReceiptEntryCallback(
      button.type === "callback" ? button.payload : "",
    ));
    const code = actions.find(action => action?.action === "code");
    const invite = actions.find(action => action?.action === "invite");
    if (code && invite && code.transferId === invite.transferId && code.version === invite.version) return source;
    const retry = actions.find(action => action?.action === "retry");
    const cancel = actions.find(action => action?.action === "cancel");
    if (retry && cancel && retry.transferId === cancel.transferId && retry.version === cancel.version) return source;
  }
  const hasContextualMenu = source.some((row) => row.some((button) => isMenuNavigationButton(button)));
  if (hasContextualMenu) return source;
  const rows = source
    .map((row) =>
      row.filter((button) => {
        if (!("payload" in button)) return true;
        const parsed = parseNativeCreateCallback(button.payload ?? "");
        return parsed?.action !== "menu" && parsed?.action !== "menu_home";
      }),
    )
    .filter((row) => row.length > 0);
  return [...rows, [{ type: "callback", text: "Главное меню", payload: MAX_MAIN_MENU_CALLBACK }]];
}
