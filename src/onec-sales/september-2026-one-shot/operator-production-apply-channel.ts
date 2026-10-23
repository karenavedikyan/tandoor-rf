/**
 * Production apply is fail-closed until a human sets SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF
 * to the pinned value alongside an authorized scope file and verified backup receipt.
 * Not distributed for routine operator runs; synthetic tests never set this env.
 */
export const PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF =
  "SEPTEMBER-2026-HUMAN-APPLY-CHANNEL-v1";

export function assertSeptemberProductionApplyChannelOpen(): { ok: true } | {
  ok: false;
  code: "APPLY_NOT_AUTHORIZED";
  message: string;
} {
  const channelRef = process.env.SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF?.trim();
  if (channelRef !== PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF) {
    return {
      ok: false,
      code: "APPLY_NOT_AUTHORIZED",
      message: "Production apply channel is not open; operator data scope remains read-only candidate.",
    };
  }
  return { ok: true };
}
