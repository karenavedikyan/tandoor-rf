import { runLabelsBulkBootstrap } from "../bitrix24/labels/bulk-bootstrap";

function parseArgs(argv: string[]): { mode: "dry_run" | "apply"; actorUserId: string | null } {
  const apply = argv.includes("--apply");
  if (!apply) {
    return { mode: "dry_run", actorUserId: null };
  }
  const actorArg = argv.find((entry) => entry.startsWith("--actor="));
  const actorUserId = actorArg?.slice("--actor=".length).trim() || null;
  if (!actorUserId) {
    throw new Error("Apply mode requires --actor=<user-uuid>");
  }
  return { mode: "apply", actorUserId };
}

async function main(): Promise<void> {
  const { mode, actorUserId } = parseArgs(process.argv.slice(2));
  if (mode === "apply") {
    console.error("Apply mode requested. This mutates label registry and card links only.");
  } else {
    console.error("Dry-run mode (default). Pass --apply --actor=<uuid> to mutate.");
  }
  const result = await runLabelsBulkBootstrap(mode, actorUserId);
  console.log(JSON.stringify(result, null, 2));
  if (result.conflicts.length > 0 || (mode === "apply" && !result.applied)) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "bootstrap failed");
  process.exit(1);
});
