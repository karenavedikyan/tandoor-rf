import { readFile } from "node:fs/promises";
import { parseProductionCliArgs } from "../onec-sales/matched-only/production/cli-args";
import { buildNotApprovedExecutionManifestTemplate } from "../onec-sales/matched-only/production/manifest-template";
import type { ExecutionManifestV2 } from "../onec-sales/matched-only/production/manifest-types";
import { runProductionPreflight } from "../onec-sales/matched-only/production/preflight";
import { runProductionWriteApply, runProductionWriteRollback } from "../onec-sales/matched-only/production/executor";

async function loadManifest(path: string): Promise<ExecutionManifestV2> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as ExecutionManifestV2;
  if (manifest.v !== 2 || manifest.policy !== "matched-only") {
    throw new Error("INVALID_MANIFEST_FILE");
  }
  return manifest;
}

async function main(): Promise<void> {
  const parsed = parseProductionCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, code: parsed.code, message: parsed.message }));
    process.exit(1);
  }
  const args = parsed.args;

  if (args.mode === "emit-template") {
    const template = buildNotApprovedExecutionManifestTemplate(args.templateOperation ?? "apply");
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  const manifest = await loadManifest(args.manifestFile!);

  if (args.mode === "preflight" || args.mode === "validate-backup-proof") {
    const result = await runProductionPreflight({
      manifest,
      operation: args.operation,
      approvedExecutionHash: args.approvedExecutionHash,
      writeMode: false,
    });
    if (!result.ok) {
      console.error(JSON.stringify(result));
      process.exit(1);
    }
    const output =
      args.mode === "validate-backup-proof"
        ? {
            ok: true,
            mode: "validate-backup-proof",
            executionId: result.executionId,
            planHash: result.planHash,
            backupProof: result.backupProof ?? null,
          }
        : result;
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (args.mode === "write-apply") {
    const result = await runProductionWriteApply({
      manifest,
      approvedExecutionHash: args.approvedExecutionHash!,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (args.mode === "write-rollback") {
    const result = await runProductionWriteRollback({
      manifest,
      approvedExecutionHash: args.approvedExecutionHash!,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  console.error(JSON.stringify({ ok: false, code: "CLI_MODE_UNSUPPORTED", message: "Unsupported mode." }));
  process.exit(1);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: "PRODUCTION_EXECUTOR_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
