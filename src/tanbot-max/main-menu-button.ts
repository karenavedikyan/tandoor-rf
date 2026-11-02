import type { MaxInlineButton } from "./delivery-transport";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../tanbot/native-create/menu-sentinel";

/** Navigation only: opens the home screen, not the compact menu panel. */
export const MAX_MAIN_MENU_CALLBACK = buildNativeCreateCallback("menu_home", NATIVE_MENU_DRAFT_HEX, 1)!;

function isMenuNavigationButton(button: MaxInlineButton): boolean {
  if (button.type !== "callback") {
    return button.text.trim().toLowerCase() === "меню";
  }
  const parsed = parseNativeCreateCallback(button.payload ?? "");
  return parsed?.action === "menu" || parsed?.action === "menu_home";
}

/** Exactly one footer when inline navigation lacks its own path to menu/home. */
export function withMaxMainMenuButton(buttons?: MaxInlineButton[][]): MaxInlineButton[][] {
  const source = (buttons ?? []).map((row) => [...row]).filter((row) => row.length > 0);
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
