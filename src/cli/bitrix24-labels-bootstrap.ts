import { runLabelsBulkBootstrap } from "../bitrix24/labels/bulk-bootstrap";

function parseArgs(argv: string[]): {
  mode: "dry_run" | "apply";
  actorUserId: string | null;
  expectedFingerprint: string | null;
} {
  const apply = argv.includes("--apply");
  if (!apply) {
    return { mode: "dry_run", actorUserId: null, expectedFingerprint: null };
  }
  const actorArg = argv.find((entry) => entry.startsWith("--actor="));
  const actorUserId = actorArg?.slice("--actor=".length).trim() || null;
  if (!actorUserId) {
    throw new Error("Apply mode requires --actor=<user-uuid>");
  }
  const fingerprintArg = argv.find((entry) => entry.startsWith("--fingerprint="));
  const expectedFingerprint = fingerprintArg?.slice("--fingerprint=".length).trim() || null;
  if (!expectedFingerprint) {
    throw new Error("Apply mode requires --fingerprint=<dry-run-sha256>");
  }
  return { mode: "apply", actorUserId, expectedFingerprint };
}

async function main(): Promise<void> {
  const { mode, actorUserId, expectedFingerprint } = parseArgs(process.argv.slice(2));
  if (mode === "apply") {
    console.error("Apply mode requested. This mutates label registry and card links only.");
  } else {
    console.error("Dry-run mode (default). Pass --apply --actor=<uuid> --fingerprint=<hash> to mutate.");
  }
  const result = await runLabelsBulkBootstrap(mode, actorUserId, expectedFingerprint);
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
