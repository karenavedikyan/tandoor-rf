import {
  buildNativeBotCommandInstallPlan,
  runNativeBotCommandInstall,
  type CommandInstallTarget,
} from "../tanbot/native-create/bot-command-registry";
import {
  createMaxCommandInstallTransport,
  createTelegramCommandInstallTransport,
} from "../tanbot/native-create/bot-command-install-provider";

export function parseTanbotInstallMessengerCommandsArgs(
  argv: string[],
): { ok: true; target: CommandInstallTarget; apply: boolean } | { ok: false } {
  let target: CommandInstallTarget | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      if (apply) return { ok: false };
      apply = true;
      continue;
    }
    if (arg === "--telegram") {
      if (target !== null) return { ok: false };
      target = "telegram";
      continue;
    }
    if (arg === "--max") {
      if (target !== null) return { ok: false };
      target = "max";
      continue;
    }
    return { ok: false };
  }
  if (!target) return { ok: false };
  return { ok: true, target, apply };
}

async function main(): Promise<void> {
  const parsed = parseTanbotInstallMessengerCommandsArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(
      "Usage: node dist/cli/tanbot-install-messenger-commands.js (--telegram | --max) [--apply]\n" +
        "Default is dry-run: prints plan only, no network.\n",
    );
    process.exit(2);
  }
  const { target, apply } = parsed;
  const plan = buildNativeBotCommandInstallPlan(target, { dryRun: !apply });
  const transport = apply
    ? target === "telegram"
      ? createTelegramCommandInstallTransport()
      : createMaxCommandInstallTransport()
    : undefined;
  const result = await runNativeBotCommandInstall(plan, transport);
  process.stdout.write(
    JSON.stringify(
      {
        target: plan.target,
        dryRun: plan.dryRun,
        commands: plan.commands,
        result,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("tanbot-install-messenger-commands failed unexpectedly.\n");
    process.exit(1);
  });
}
