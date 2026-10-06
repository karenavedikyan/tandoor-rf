import type { OnecFtpConfig } from "../onec-ftp/types";
import {
  EMPLOYEES_RELATIVE_PATH,
  parseWholesaleEmployeeRosterBytes,
  type WholesaleEmployeeRoster,
} from "./employee-roster";
import { readRemoteFileFromFtp } from "./ftp-read";
import { FTP_READ_DEADLINE_MS } from "./constants";

export type StableRosterReadFailureCode =
  | "FTP_ERROR"
  | "TIMEOUT"
  | "VALIDATION_FAILED"
  | "UNSTABLE_SOURCE"
  | "FILE_TOO_LARGE";

export type StableRosterReadResult =
  | { ok: true; roster: WholesaleEmployeeRoster; readCount: number }
  | {
      ok: false;
      code: StableRosterReadFailureCode;
      message: string;
      readCount: number;
      firstSha256?: string;
      secondSha256?: string;
    };

export type EmployeeRosterReader = (
  config: OnecFtpConfig,
  context?: { readDeadlineMs?: number },
) => Promise<
  | { ok: true; bytes: Buffer }
  | { ok: false; code: "FTP_ERROR" | "TIMEOUT" | "FILE_TOO_LARGE"; message: string }
>;

function buildEmployeesRemotePath(basePath: string): string {
  return `${basePath.replace(/\/+$/, "")}/${EMPLOYEES_RELATIVE_PATH}`;
}

export const defaultEmployeeRosterReader: EmployeeRosterReader = async (config, context) => {
  const result = await readRemoteFileFromFtp(
    config,
    buildEmployeesRemotePath(config.basePath),
    32 * 1024 * 1024,
    context?.readDeadlineMs ?? FTP_READ_DEADLINE_MS,
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, bytes: result.bytes };
};

export async function readStableEmployeeRosterFile(
  config: OnecFtpConfig,
  options: {
    reader?: EmployeeRosterReader;
    stabilityDelayMs: number;
    readDeadlineMs?: number;
  },
): Promise<StableRosterReadResult> {
  const reader = options.reader ?? defaultEmployeeRosterReader;
  const context = { readDeadlineMs: options.readDeadlineMs };
  let readCount = 0;

  const firstRead = await reader(config, context);
  readCount += 1;
  if (!firstRead.ok) {
    return {
      ok: false,
      code: firstRead.code === "TIMEOUT" ? "TIMEOUT" : firstRead.code === "FILE_TOO_LARGE" ? "FILE_TOO_LARGE" : "FTP_ERROR",
      message: firstRead.message,
      readCount,
    };
  }

  const firstParsed = parseWholesaleEmployeeRosterBytes(firstRead.bytes);
  if (!firstParsed.ok) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: firstParsed.message,
      readCount,
    };
  }

  if (options.stabilityDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.stabilityDelayMs));
  }

  const secondRead = await reader(config, context);
  readCount += 1;
  if (!secondRead.ok) {
    return {
      ok: false,
      code: secondRead.code === "TIMEOUT" ? "TIMEOUT" : secondRead.code === "FILE_TOO_LARGE" ? "FILE_TOO_LARGE" : "FTP_ERROR",
      message: secondRead.message,
      readCount,
      firstSha256: firstParsed.roster.sourceSha256,
    };
  }

  if (!firstRead.bytes.equals(secondRead.bytes)) {
    const secondParsed = parseWholesaleEmployeeRosterBytes(secondRead.bytes);
    return {
      ok: false,
      code: "UNSTABLE_SOURCE",
      message: "Employee roster changed between stability reads.",
      readCount,
      firstSha256: firstParsed.roster.sourceSha256,
      secondSha256: secondParsed.ok ? secondParsed.roster.sourceSha256 : undefined,
    };
  }

  return { ok: true, roster: firstParsed.roster, readCount };
}
