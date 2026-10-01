import { runLabelsBulkBootstrap } from "../bitrix24/labels/bulk-bootstrap";

function parseMode(argv: string[]): "dry_run" | "apply" {
  if (argv.includes("--apply")) {
    return "apply";
  }
  return "dry_run";
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "apply") {
    console.error("Apply mode requested. This mutates label registry and card links only.");
  }
  const result = await runLabelsBulkBootstrap(mode, null);
  console.log(JSON.stringify(result, null, 2));
  if (result.conflicts.length > 0) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "bootstrap failed");
  process.exit(1);
});
