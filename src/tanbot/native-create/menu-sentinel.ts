/** Callback draft id for main-menu actions that do not require an active wizard draft. */
export const NATIVE_MENU_DRAFT_HEX = "00000000000000000000000000000000";

export function isNativeMenuDraftHex(hex: string): boolean {
  return hex.toLowerCase() === NATIVE_MENU_DRAFT_HEX;
}
