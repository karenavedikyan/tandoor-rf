import { getDatabaseUrl } from "../config";
import { parseCleanReloadCliArgs } from "./cli-args";
import { runCleanReload, type CleanReloadResult } from "./clean-reload";

export function getCleanReloadExitCode(result: CleanReloadResult): number {
  return result.ok ? 0 : 1;
}

const HELP_TEXT = `onec-clean-reload — client composition replacement for tandoor-rf

Usage:
  npm run onec-clean-reload:local -- --dry-run --bundle-dir /path/to/bundle
  npm run onec-clean-reload:local -- --apply --bundle-dir /path/to/bundle \\
    --expected-bundle-fingerprint <hex> --confirm-target-db <hex> \\
    --confirm-extended-contract --operator-reference "<ticket>"

Bundle layout (clients + wholesale employees only):
  all_clients.json
  all_employees.json

Catalog and catalog images are never modified by this procedure.

Dry-run prints targetDbFingerprint, bundleFingerprint, and composition stats for apply guards.
Apply replaces test client composition, retail outlets, and wholesale employee roster in one transaction.
`;

export async function runCleanReloadCli(argv: string[] = process.argv.slice(2)): Promise<CleanReloadResult> {
  const parsed = parseCleanReloadCliArgs(argv);
  if (!parsed.ok) {
    if (parsed.code === "HELP") {
      process.stdout.write(HELP_TEXT);
      return {
        ok: true,
        mode: "dry_run",
        durationMs: 0,
        plan: {
          targetDbFingerprint: "",
          bundleFingerprint: "",
          stats: {
            clientsRecordCount: 0,
            retailOutletsOpen: 0,
            retailOutletsClosed: 0,
            retailOutletsWithoutGuidStore: 0,
            wholesaleEmployeeCount: 0,
            employeesWithoutClients: 0,
            assignmentsOutsideRoster: 0,
            clientsWithoutManager: 0,
            unresolvedHoldingLinks: 0,
          },
          purgeScope: { tableGroups: [], orphanCleanupStatements: 0, catalogUntouched: true },
        },
      };
    }
    return {
      ok: false,
      mode: "dry_run",
      durationMs: 0,
      code: parsed.code,
      message: parsed.message,
    };
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return {
      ok: false,
      mode: parsed.options.mode,
      durationMs: 0,
      code: "DATABASE_ERROR",
      message: "DATABASE_URL is not configured.",
    };
  }

  return runCleanReload({
    mode: parsed.options.mode,
    bundleDir: parsed.options.bundleDir,
    databaseUrl,
    holdingLinkPolicy: parsed.options.holdingLinkPolicy,
    expectedBundleFingerprint: parsed.options.expectedBundleFingerprint,
    confirmTargetDb: parsed.options.confirmTargetDb,
    confirmExtendedContract: parsed.options.confirmExtendedContract,
    operatorReference: parsed.options.operatorReference,
    operatorNote: parsed.options.operatorNote,
  });
}
