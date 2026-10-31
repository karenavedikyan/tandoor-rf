import {
  buildNativeBotCommandInstallPlan,
  runNativeBotCommandInstall,
  type CommandInstallTarget,
} from "../tanbot/native-create/bot-command-registry";

function parseArgs(argv: string[]): { target: CommandInstallTarget | null; apply: boolean } {
  let target: CommandInstallTarget | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--telegram") target = "telegram";
    else if (arg === "--max") target = "max";
  }
  return { target, apply };
}

async function main(): Promise<void> {
  const { target, apply } = parseArgs(process.argv.slice(2));
  if (!target) {
    process.stderr.write(
      "Usage: node dist/cli/tanbot-install-messenger-commands.js (--telegram | --max) [--apply]\n" +
        "Default is dry-run: prints plan only, no network.\n",
    );
    process.exit(2);
  }
  const plan = buildNativeBotCommandInstallPlan(target, { dryRun: !apply });
  const result = await runNativeBotCommandInstall(plan);
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

main().catch(() => {
  process.stderr.write("tanbot-install-messenger-commands failed unexpectedly.\n");
  process.exit(1);
});
