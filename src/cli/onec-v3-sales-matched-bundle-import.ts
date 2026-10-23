import { writeFile } from "node:fs/promises";
import { getDatabaseUrl } from "../config";
import { parseLegalReturnItemsJsonBytes } from "../onec-sales/parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../onec-sales/parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "../onec-sales/parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../onec-sales/parse-sale-json";
import { readSalesBundleFilesFromPaths } from "../onec-sales/run-bundle-import";
import { backupSha256 } from "../onec-sales/matched-only/backup";
import { planHashFromPlan } from "../onec-sales/matched-only/plan-build";
import {
  captureMatchedOnlyBackupForPlan,
  runMatchedOnlyApply,
  runMatchedOnlyBundlePlan,
  runMatchedOnlyRollback,
  runMatchedOnlyValidateBackup,
} from "../onec-sales/matched-only/run";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "../onec-sales/matched-only/types";
import { readFile } from "node:fs/promises";

type CliMode = "plan" | "validate-backup" | "apply" | "rollback" | "capture-backup";

function usage(): string {
  return `Usage:
  onec-v3-sales-matched-bundle-import --plan --sale-aggregate <path> --sale-items <path> --returns-aggregate <path> --return-items <path> [--out-plan <path>]
  onec-v3-sales-matched-bundle-import --capture-backup --plan-file <path> --out-backup <path>
  onec-v3-sales-matched-bundle-import --validate-backup --plan-file <path> --backup-file <path> [--expected-backup-sha256 <hex>]
  onec-v3-sales-matched-bundle-import --apply --plan-file <path> --backup-file <path> --approved-plan-hash <hex> --expected-backup-sha256 <hex> [--sale-aggregate ... four paths]
  onec-v3-sales-matched-bundle-import --rollback --plan-file <path> --backup-file <path> --approved-plan-hash <hex>

Default mode is read-only plan. Apply/rollback require TEST_DATABASE_URL.`;
}

function parseArgs(argv: string[]): {
  mode: CliMode;
  paths?: {
    saleAggregate: string;
    saleItems: string;
    returnsAggregate: string;
    returnItems: string;
  };
  planFile?: string;
  backupFile?: string;
  outPlan?: string;
  outBackup?: string;
  approvedPlanHash?: string;
  expectedBackupSha256?: string;
} {
  let mode: CliMode = "plan";
  const paths: Partial<{
    saleAggregate: string;
    saleItems: string;
    returnsAggregate: string;
    returnItems: string;
  }> = {};
  let planFile: string | undefined;
  let backupFile: string | undefined;
  let outPlan: string | undefined;
  let outBackup: string | undefined;
  let approvedPlanHash: string | undefined;
  let expectedBackupSha256: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") {
      mode = "plan";
      continue;
    }
    if (arg === "--validate-backup") {
      mode = "validate-backup";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg === "--rollback") {
      mode = "rollback";
      continue;
    }
    if (arg === "--capture-backup") {
      mode = "capture-backup";
      continue;
    }
    if (arg === "--sale-aggregate") {
      paths.saleAggregate = argv[++i] ?? "";
      continue;
    }
    if (arg === "--sale-items") {
      paths.saleItems = argv[++i] ?? "";
      continue;
    }
    if (arg === "--returns-aggregate") {
      paths.returnsAggregate = argv[++i] ?? "";
      continue;
    }
    if (arg === "--return-items") {
      paths.returnItems = argv[++i] ?? "";
      continue;
    }
    if (arg === "--plan-file") {
      planFile = argv[++i];
      continue;
    }
    if (arg === "--backup-file") {
      backupFile = argv[++i];
      continue;
    }
    if (arg === "--out-plan") {
      outPlan = argv[++i];
      continue;
    }
    if (arg === "--out-backup") {
      outBackup = argv[++i];
      continue;
    }
    if (arg === "--approved-plan-hash") {
      approvedPlanHash = argv[++i]?.toLowerCase();
      continue;
    }
    if (arg === "--expected-backup-sha256") {
      expectedBackupSha256 = argv[++i]?.toLowerCase();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (mode === "plan") {
    if (!paths.saleAggregate || !paths.saleItems || !paths.returnsAggregate || !paths.returnItems) {
      throw new Error("Plan mode requires four bundle file paths.");
    }
  }

  return {
    mode,
    paths: paths.saleAggregate
      ? {
          saleAggregate: paths.saleAggregate,
          saleItems: paths.saleItems!,
          returnsAggregate: paths.returnsAggregate!,
          returnItems: paths.returnItems!,
        }
      : undefined,
    planFile,
    backupFile,
    outPlan,
    outBackup,
    approvedPlanHash,
    expectedBackupSha256,
  };
}

async function loadPlan(path: string): Promise<MatchedOnlyBundlePlanV1> {
  const plan = JSON.parse(await readFile(path, "utf8")) as MatchedOnlyBundlePlanV1;
  if (plan.v !== 1 || plan.policy !== "matched-only") {
    throw new Error("INVALID_PLAN_FILE");
  }
  return plan;
}

async function loadRosters(paths: {
  saleAggregate: string;
  saleItems: string;
  returnsAggregate: string;
  returnItems: string;
}) {
  const files = await readSalesBundleFilesFromPaths(paths);
  const saleAggregate = parseLegalSalesJsonBytes(files.saleAggregate!);
  const saleItems = parseLegalSaleItemsJsonBytes(files.saleItems!);
  const returnsAggregate = parseLegalReturnsJsonBytes(files.returnsAggregate!);
  const returnItems = parseLegalReturnItemsJsonBytes(files.returnItems!);
  if (!saleAggregate.ok) throw new Error(saleAggregate.message);
  if (!saleItems.ok) throw new Error(saleItems.message);
  if (!returnsAggregate.ok) throw new Error(returnsAggregate.message);
  if (!returnItems.ok) throw new Error(returnItems.message);
  return {
    saleAggregate: saleAggregate.roster,
    saleItems: saleItems.roster,
    returnsAggregate: returnsAggregate.roster,
    returnItems: returnItems.roster,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.TEST_DATABASE_URL ?? getDatabaseUrl();
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, code: "DATABASE_URL_MISSING" }));
    process.exit(1);
  }

  if (args.mode === "plan" && args.paths) {
    const rosters = await loadRosters(args.paths);
    const result = await runMatchedOnlyBundlePlan(databaseUrl, rosters);
    if (!result.ok || !result.plan) {
      console.error(JSON.stringify(result));
      process.exit(1);
    }
    const planHash = planHashFromPlan(result.plan);
    const output = { ok: true, planHash, plan: result.plan };
    if (args.outPlan) {
      await writeFile(args.outPlan, `${JSON.stringify(result.plan, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (args.mode === "capture-backup") {
    if (!args.planFile || !args.outBackup) {
      throw new Error("capture-backup requires --plan-file and --out-backup");
    }
    const plan = await loadPlan(args.planFile);
    const backup = await captureMatchedOnlyBackupForPlan(databaseUrl, plan);
    const sha = backupSha256(backup);
    await writeFile(args.outBackup, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, backupSha256: sha, planHash: planHashFromPlan(plan) }, null, 2));
    return;
  }

  if (args.mode === "validate-backup") {
    if (!args.planFile || !args.backupFile) {
      throw new Error("validate-backup requires --plan-file and --backup-file");
    }
    const plan = await loadPlan(args.planFile);
    const result = await runMatchedOnlyValidateBackup(
      databaseUrl,
      plan,
      args.backupFile,
      args.expectedBackupSha256,
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (args.mode === "apply") {
    if (!args.planFile || !args.backupFile || !args.approvedPlanHash || !args.expectedBackupSha256 || !args.paths) {
      throw new Error("apply requires plan, backup, hashes, and four source files");
    }
    const plan = await loadPlan(args.planFile);
    const backup = JSON.parse(await readFile(args.backupFile, "utf8")) as MatchedOnlyScopedBackupV1;
    const rosters = await loadRosters(args.paths);
    const result = await runMatchedOnlyApply(
      databaseUrl,
      rosters,
      plan,
      args.approvedPlanHash,
      backup,
      args.expectedBackupSha256,
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (args.mode === "rollback") {
    if (!args.planFile || !args.backupFile || !args.approvedPlanHash) {
      throw new Error("rollback requires --plan-file, --backup-file, --approved-plan-hash");
    }
    const plan = await loadPlan(args.planFile);
    const backup = JSON.parse(await readFile(args.backupFile, "utf8")) as MatchedOnlyScopedBackupV1;
    const result = await runMatchedOnlyRollback(databaseUrl, plan, args.approvedPlanHash, backup);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  console.error(usage());
  process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
