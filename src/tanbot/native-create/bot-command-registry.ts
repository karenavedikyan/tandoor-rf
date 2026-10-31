/** Managed bot commands for future provider registration (not applied automatically). */

export type ManagedMessengerBotCommand = {
  command: string;
  description?: string | null;
};

export const MANAGED_NATIVE_BOT_COMMANDS: ManagedMessengerBotCommand[] = [
  { command: "menu", description: "Меню" },
  { command: "new", description: "Оформить передачу" },
  { command: "my", description: "Мои передачи" },
];

/** Hide the redundant suggestion only. /start handler and invitation deep links remain active. */
export const HIDDEN_NATIVE_BOT_COMMANDS = ["start"] as const;
export type CommandInstallTarget = "telegram" | "max";

export type CommandInstallPlan = {
  target: CommandInstallTarget;
  commands: ManagedMessengerBotCommand[];
  dryRun: boolean;
  hiddenCommands?: readonly string[];
};

export function buildNativeBotCommandInstallPlan(
  target: CommandInstallTarget,
  options: { dryRun?: boolean } = {},
): CommandInstallPlan {
  return {
    target,
    commands: [...MANAGED_NATIVE_BOT_COMMANDS],
    hiddenCommands: [...HIDDEN_NATIVE_BOT_COMMANDS],
    dryRun: options.dryRun !== false,
  };
}

/** Merge managed commands ahead of custom entries without dropping unknown commands. */
export function mergeManagedBotCommands(
  existing: ManagedMessengerBotCommand[],
  managed: ManagedMessengerBotCommand[],
  hiddenCommands: readonly string[] = [],
): ManagedMessengerBotCommand[] {
  const hidden = new Set(hiddenCommands.map(name => name.toLowerCase()));
  const seen = new Set<string>();
  const out: ManagedMessengerBotCommand[] = [];
  for (const cmd of managed) {
    const key = cmd.command.toLowerCase();
    if (hidden.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  for (const cmd of existing) {
    const key = cmd.command.toLowerCase();
    if (hidden.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  return out;
}

export type CommandInstallResult =
  | { ok: true; dryRun: boolean; mergedCount: number }
  | { ok: false; code: "network" | "redirect" | "timeout" | "provider_error"; message: string };

export type CommandInstallTransport = (
  plan: CommandInstallPlan,
) => Promise<CommandInstallResult>;

/** Default transport is a no-op success in dry-run; live apply must be injected by CLI. */
export async function runNativeBotCommandInstall(
  plan: CommandInstallPlan,
  transport?: CommandInstallTransport,
): Promise<CommandInstallResult> {
  if (plan.dryRun) {
    return { ok: true, dryRun: true, mergedCount: plan.commands.length };
  }
  if (!transport) {
    return { ok: false, code: "provider_error", message: "Apply requires an explicit transport." };
  }
  return transport(plan);
}
