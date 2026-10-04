import { getDatabaseUrl } from "../config";
import { parseCleanReloadCliArgs } from "./cli-args";
import { runCleanReload, type CleanReloadResult } from "./clean-reload";

export function getCleanReloadExitCode(result: CleanReloadResult): number {
  return result.ok ? 0 : 1;
}

const HELP_TEXT = `onec-clean-reload — explicit wholesale clean reload for tandoor-rf

Usage:
  npm run onec-clean-reload:local -- --dry-run --bundle-dir /path/to/bundle
  npm run onec-clean-reload:local -- --apply --bundle-dir /path/to/bundle \\
    --expected-bundle-fingerprint <hex> --confirm-target-db <hex> \\
    --confirm-extended-contract --operator-reference "<ticket>"

Bundle layout:
  all_clients.json
  all_employees.json
  catalog/groups/data.xml
  catalog/section/data.xml
  ... (full profile: 8 XML files)

Dry-run prints targetDbFingerprint and bundleFingerprint for apply guards.
Apply purges test client/catalog scope, imports pinned bundle bytes, then optional image-sync.
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
          catalogManifestSha256: "",
          clientsRecordCount: 0,
          wholesaleEmployeeCount: 0,
          catalogProductCount: 0,
          purgeScope: { tableGroups: [], orphanCleanupStatements: 0 },
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
    catalogProfile: parsed.options.catalogProfile,
    expectedBundleFingerprint: parsed.options.expectedBundleFingerprint,
    confirmTargetDb: parsed.options.confirmTargetDb,
    confirmExtendedContract: parsed.options.confirmExtendedContract,
    operatorReference: parsed.options.operatorReference,
    operatorNote: parsed.options.operatorNote,
    skipCatalog: parsed.options.skipCatalog,
    skipImageSync: parsed.options.skipImageSync,
  });
}
