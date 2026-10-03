import { getDatabaseUrl } from "../config";
import {
  parseBaselineReplacementCliArgs,
  readBaselineFileBytes,
} from "./baseline-replacement-cli-args";
import { runBaselineReplacement, type BaselineReplacementResult } from "./baseline-replacement";

export function getBaselineReplacementExitCode(result: BaselineReplacementResult): number {
  return result.ok ? 0 : 1;
}

export type RunBaselineReplacementCliOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  clientsBytes?: Buffer;
  employeeRosterBytes?: Buffer;
  quarantineManifestBytes?: Buffer;
};

export async function runBaselineReplacementCli(
  options: RunBaselineReplacementCliOptions = {},
): Promise<BaselineReplacementResult> {
  const startedAt = Date.now();
  const parsed = parseBaselineReplacementCliArgs(options.argv ?? []);
  if (!parsed.ok) {
    return {
      ok: false,
      mode: "dry_run",
      durationMs: Date.now() - startedAt,
      code: parsed.code,
      message: parsed.message,
    };
  }

  const cli = parsed.options;
  const databaseUrl = (options.env ?? process.env).DATABASE_URL ?? getDatabaseUrl() ?? undefined;

  if (cli.mode === "rollback") {
    return runBaselineReplacement({
      databaseUrl,
      mode: "rollback",
      clientsBytes: Buffer.alloc(0),
      quarantineManifestBytes: Buffer.alloc(0),
      rollbackRunId: cli.rollbackRunId,
      operatorNote: cli.operatorNote,
    });
  }

  const clientsBytesRead =
    options.clientsBytes ?? readBaselineFileBytes(cli.clientsFile);
  if (!Buffer.isBuffer(clientsBytesRead)) {
    return {
      ok: false,
      mode: cli.mode,
      durationMs: Date.now() - startedAt,
      code: clientsBytesRead.code,
      message: clientsBytesRead.message,
    };
  }
  const clientsBytes = clientsBytesRead;

  const quarantineManifestRead =
    options.quarantineManifestBytes ?? readBaselineFileBytes(cli.quarantineManifestFile);
  if (!Buffer.isBuffer(quarantineManifestRead)) {
    return {
      ok: false,
      mode: cli.mode,
      durationMs: Date.now() - startedAt,
      code: quarantineManifestRead.code,
      message: quarantineManifestRead.message,
    };
  }
  const quarantineManifestBytes = quarantineManifestRead;

  let employeeRosterBytes = options.employeeRosterBytes;
  if (!employeeRosterBytes && cli.employeeRosterFile) {
    const rosterRead = readBaselineFileBytes(cli.employeeRosterFile);
    if (!Buffer.isBuffer(rosterRead)) {
      return {
        ok: false,
        mode: cli.mode,
        durationMs: Date.now() - startedAt,
        code: rosterRead.code,
        message: rosterRead.message,
      };
    }
    employeeRosterBytes = rosterRead;
  }

  return runBaselineReplacement({
    databaseUrl,
    mode: cli.mode,
    clientsBytes,
    employeeRosterBytes,
    quarantineManifestBytes,
    holdingLinkValidationPolicy: cli.holdingLinkValidationPolicy,
    expectedFingerprint: cli.expectedFingerprint,
    confirmExtendedContract: cli.confirmExtendedContract,
    operatorReference: cli.operatorReference,
    operatorNote: cli.operatorNote,
  });
}
