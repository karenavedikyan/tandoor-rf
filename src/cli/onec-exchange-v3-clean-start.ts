#!/usr/bin/env node
import { getDatabaseUrl } from "../config";
import { readStableV3Bundle } from "../onec-exchange-v3/read-stable-bundle";
import {
  loadValidatedBundleFromBytes,
  runExchangeV3CleanStartApply,
  runExchangeV3CleanStartDryRun,
} from "../onec-exchange-v3/clean-start";
import { formatTargetDbForReport } from "../onec-exchange-v3/target-db-fingerprint";

function argValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes("--apply") ? "apply" : "dry_run";
  const bundleDir = argValue(args, "--bundle-dir");
  const confirmTarget = argValue(args, "--confirm-target-db-fingerprint");
  const confirmBundle = argValue(args, "--confirm-bundle-fingerprint");
  const force = args.includes("--force-clean-start");

  if (!args.includes("--i-understand")) {
    console.error("Refusing: pass --i-understand");
    process.exit(2);
  }
  if (!bundleDir) {
    console.error("Required: --bundle-dir=...");
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || getDatabaseUrl();
  if (!databaseUrl) {
    console.error("DATABASE_URL required");
    process.exit(2);
  }

  const stable = await readStableV3Bundle({ bundleDir });
  if (!stable.ok) {
    console.error(JSON.stringify({ ok: false, error: stable.message, code: stable.code }));
    process.exit(1);
  }
  const validated = loadValidatedBundleFromBytes(stable.bundle);
  if (!validated.ok) {
    console.error(JSON.stringify({ ok: false, error: validated.message, code: validated.errorCode }));
    process.exit(1);
  }

  if (mode === "dry_run") {
    const report = await runExchangeV3CleanStartDryRun(databaseUrl, validated.bundle);
    console.log(
      JSON.stringify(
        {
          ok: report.blockers.length === 0,
          targetDbLabel: formatTargetDbForReport(databaseUrl),
          report,
        },
        null,
        2,
      ),
    );
    process.exit(report.blockers.length === 0 ? 0 : 1);
  }

  if (!confirmTarget || !confirmBundle) {
    console.error("Apply requires --confirm-target-db-fingerprint and --confirm-bundle-fingerprint from dry-run");
    process.exit(2);
  }

  const result = await runExchangeV3CleanStartApply({
    databaseUrl,
    bundle: validated.bundle,
    confirmTargetDbFingerprint: confirmTarget,
    confirmBundleFingerprint: confirmBundle,
    forceCleanStart: force,
  });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, report: result.report }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
