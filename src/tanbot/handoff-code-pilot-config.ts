/** Pilot: handoff receipt codes via Telegram/MAX bots (default off). */
export function isTanbotHandoffCodePilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_HANDOFF_CODE_PILOT_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
