import type { MaxInlineButton } from "./delivery-transport";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../tanbot/native-create/menu-sentinel";

/** Navigation only: independent of any transfer, wizard revision or expired message. */
export const MAX_MAIN_MENU_CALLBACK = buildNativeCreateCallback("menu", NATIVE_MENU_DRAFT_HEX, 1)!;

/** Exactly one footer, preserving all business actions and leaving caller-owned arrays intact. */
export function withMaxMainMenuButton(buttons?: MaxInlineButton[][]): MaxInlineButton[][] {
  const rows = (buttons ?? [])
    .map(row => row.filter(button => !("payload" in button)
      || parseNativeCreateCallback(button.payload ?? "")?.action !== "menu"))
    .filter(row => row.length > 0);
  return [...rows, [{ type: "callback", text: "Главное меню", payload: MAX_MAIN_MENU_CALLBACK }]];
}
