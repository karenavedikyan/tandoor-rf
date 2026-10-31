/** Managed bot commands for future provider registration (not applied automatically). */

export type ManagedMessengerBotCommand = {
  command: string;
  description?: string | null;
};

export const MANAGED_NATIVE_BOT_COMMANDS: ManagedMessengerBotCommand[] = [
  { command: "start", description: "Главное меню Тандор" },
  { command: "menu", description: "Открыть главное меню" },
  { command: "new", description: "Оформить передачу" },
  { command: "my", description: "Мои передачи" },
];

export type CommandInstallTarget = "telegram" | "max";

export type CommandInstallPlan = {
  target: CommandInstallTarget;
  commands: ManagedMessengerBotCommand[];
  dryRun: boolean;
};

export function buildNativeBotCommandInstallPlan(
  target: CommandInstallTarget,
  options: { dryRun?: boolean } = {},
): CommandInstallPlan {
  return {
    target,
    commands: [...MANAGED_NATIVE_BOT_COMMANDS],
    dryRun: options.dryRun !== false,
  };
}

/** Merge managed commands ahead of custom entries without dropping unknown commands. */
export function mergeManagedBotCommands(
  existing: ManagedMessengerBotCommand[],
  managed: ManagedMessengerBotCommand[],
): ManagedMessengerBotCommand[] {
  const seen = new Set<string>();
  const out: ManagedMessengerBotCommand[] = [];
  for (const cmd of managed) {
    const key = cmd.command.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  for (const cmd of existing) {
    const key = cmd.command.toLowerCase();
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
