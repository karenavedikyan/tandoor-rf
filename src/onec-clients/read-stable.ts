import type { OnecFtpConfig } from "../onec-ftp/types";
import { defaultFtpReader, type FtpReader } from "./ftp-read";
import { validateClientsFileBytes } from "./validate";
import type { ValidatedClientsPayload } from "./types";

export type StableReadFailureCode =
  | "FTP_ERROR"
  | "TIMEOUT"
  | "VALIDATION_FAILED"
  | "UNSTABLE_SOURCE"
  | "HASH_MISMATCH";

export type StableReadResult =
  | { ok: true; payload: ValidatedClientsPayload; readCount: number }
  | {
      ok: false;
      code: StableReadFailureCode;
      message: string;
      readCount: number;
      firstSha256?: string;
      secondSha256?: string;
    };

export async function readStableClientsFile(
  config: OnecFtpConfig,
  options: {
    reader?: FtpReader;
    stabilityDelayMs: number;
    readDeadlineMs?: number;
  },
): Promise<StableReadResult> {
  const reader = options.reader ?? defaultFtpReader;
  const context = { readDeadlineMs: options.readDeadlineMs };
  let readCount = 0;

  const firstRead = await reader(config, context);
  readCount += 1;
  if (!firstRead.ok) {
    return {
      ok: false,
      code: firstRead.code === "TIMEOUT" ? "TIMEOUT" : "FTP_ERROR",
      message: firstRead.message,
      readCount,
    };
  }

  const firstValidated = validateClientsFileBytes(firstRead.bytes);
  if (!firstValidated.ok) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Client file validation failed on first read.",
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
      code: secondRead.code === "TIMEOUT" ? "TIMEOUT" : "FTP_ERROR",
      message: secondRead.message,
      readCount,
      firstSha256: firstValidated.payload.sha256,
    };
  }

  if (!firstRead.bytes.equals(secondRead.bytes)) {
    const secondValidated = validateClientsFileBytes(secondRead.bytes);
    return {
      ok: false,
      code: "UNSTABLE_SOURCE",
      message: "Source file changed between stability reads.",
      readCount,
      firstSha256: firstValidated.payload.sha256,
      secondSha256: secondValidated.ok ? secondValidated.payload.sha256 : undefined,
    };
  }

  return { ok: true, payload: firstValidated.payload, readCount };
}
