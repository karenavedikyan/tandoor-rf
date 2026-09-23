import { Client, FTPError, type FileInfo } from "basic-ftp";
import { isOnecFtpEnabled, loadOnecFtpConfig } from "./config";
import { sanitizeProbeResult } from "./sanitize";
import type {
  OnecFtpConfig,
  OnecFtpFileEntry,
  OnecFtpProbeResult,
  OnecFtpProbeStage,
  OnecFtpProbeStatus,
} from "./types";

export const MAX_LIST_ENTRIES = 500;
export const PLAIN_FTP_TRANSPORT_WARNING =
  "Login, password, and file data are transmitted without encryption.";

export type OnecFtpClientFactory = (timeoutMs: number) => Client;

const defaultClientFactory: OnecFtpClientFactory = (timeoutMs) => new Client(timeoutMs);

export function mapFileInfo(entry: FileInfo): OnecFtpFileEntry {
  const type =
    entry.isDirectory ? "directory" : entry.isFile ? "file" : "other";
  return {
    name: entry.name,
    type,
    size: typeof entry.size === "number" ? entry.size : null,
    modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
  };
}

function classifyError(
  error: unknown,
  stage: OnecFtpProbeStage,
): Pick<OnecFtpProbeResult, "status" | "stage" | "ftpCode" | "message"> {
  if (error instanceof FTPError) {
    const code = error.code;

    if (code === 530) {
      return {
        status: "AUTH_FAILED",
        stage: "authentication",
        ftpCode: code,
        message: "FTP authentication failed.",
      };
    }
    if (code === 550) {
      if (stage === "list_transfer" || stage === "base_path_access") {
        return {
          status: stage === "list_transfer" ? "LIST_FAILED" : "PATH_ACCESS_DENIED",
          stage,
          ftpCode: code,
          message:
            stage === "list_transfer"
              ? "Directory listing was rejected by the server."
              : "Base path access was rejected by the server.",
        };
      }
      return {
        status: "PATH_ACCESS_DENIED",
        stage: "base_path_access",
        ftpCode: code,
        message: "Base path access was rejected by the server.",
      };
    }

    return {
      status: stage === "list_transfer" ? "LIST_FAILED" : "NETWORK_ERROR",
      stage,
      ftpCode: code,
      message: "FTP command failed.",
    };
  }

  if (error instanceof ProbeTimeoutError) {
    return {
      status: "TIMEOUT",
      stage,
      message: "FTP probe timed out.",
    };
  }

  const code = getErrorCode(error);
  if (isNetworkError(code)) {
    return {
      status: "NETWORK_ERROR",
      stage: stage === "complete" ? "connect" : stage,
      message: "FTP network connection failed.",
    };
  }

  return {
    status: "NETWORK_ERROR",
    stage,
    message: "FTP probe failed.",
  };
}

class ProbeTimeoutError extends Error {
  constructor() {
    super("FTP probe timed out.");
    this.name = "ProbeTimeoutError";
  }
}

class ProbeDeadline {
  private readonly expiresAt: number;
  private timer: NodeJS.Timeout | undefined;
  private readonly abortPromise: Promise<never>;

  constructor(timeoutMs: number) {
    this.expiresAt = Date.now() + timeoutMs;
    this.abortPromise = new Promise((_, reject) => {
      this.timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs);
    });
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  async run<T>(promise: Promise<T>): Promise<T> {
    if (this.remainingMs() <= 0) {
      throw new ProbeTimeoutError();
    }
    return Promise.race([promise, this.abortPromise]);
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function isNetworkError(code: string | undefined): boolean {
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  );
}

function withProbeMetadata(
  result: Omit<OnecFtpProbeResult, "security" | "transportWarning">,
): OnecFtpProbeResult {
  return {
    ...result,
    security: "plain",
    transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
  };
}

export type ProbeOnecFtpOptions = {
  clientFactory?: OnecFtpClientFactory;
};

export async function probeOnecFtp(
  config: OnecFtpConfig,
  options?: ProbeOnecFtpOptions,
): Promise<OnecFtpProbeResult> {
  if (config.security !== "plain") {
    return {
      status: "CONFIG_ERROR",
      stage: "config",
      durationMs: 0,
      message: "ONEC_FTP_SECURITY must be 'plain'.",
      basePath: config.basePath,
    };
  }

  const startedAt = Date.now();
  const deadline = new ProbeDeadline(config.timeoutMs);
  const clientFactory = options?.clientFactory ?? defaultClientFactory;
  const client = clientFactory(config.timeoutMs);
  client.ftp.verbose = false;

  let stage: OnecFtpProbeStage = "connect";

  try {
    await deadline.run(
      client.access({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        secure: false,
      }),
    );

    stage = "authentication";
    stage = "base_path_access";
    await deadline.run(client.cd(config.basePath));

    const workingDirectory = await deadline.run(client.pwd());

    stage = "list_transfer";
    const listing = await deadline.run(client.list());

    const mapped = listing.map(mapFileInfo);
    const truncated = mapped.length > MAX_LIST_ENTRIES;
    const files = mapped.slice(0, MAX_LIST_ENTRIES);

    if (JSON.stringify(files).length > 64_000) {
      return sanitizeProbeResult(
        withProbeMetadata({
          status: "OUTPUT_LIMIT_EXCEEDED",
          stage: "list_transfer",
          durationMs: Date.now() - startedAt,
          message: "Directory listing output exceeds the allowed size limit.",
          basePath: config.basePath,
          workingDirectory,
          fileCount: files.length,
          truncated: true,
        }),
        [config.password],
      );
    }

    return sanitizeProbeResult(
      withProbeMetadata({
        status: "SUCCESS",
        stage: "complete",
        durationMs: Date.now() - startedAt,
        message: "Plain FTP probe completed successfully.",
        basePath: config.basePath,
        workingDirectory,
        files,
        fileCount: files.length,
        truncated,
      }),
      [config.password],
    );
  } catch (error) {
    if (error instanceof ProbeTimeoutError && !client.closed) {
      client.close();
    }
    const classified = classifyError(error, stage);
    return sanitizeProbeResult(
      withProbeMetadata({
        ...classified,
        durationMs: Date.now() - startedAt,
        basePath: config.basePath,
      }),
      [config.password],
    );
  } finally {
    deadline.dispose();
    client.close();
  }
}

export async function runOnecFtpProbe(
  env: NodeJS.ProcessEnv = process.env,
  options?: ProbeOnecFtpOptions,
): Promise<OnecFtpProbeResult> {
  const startedAt = Date.now();

  if (!isOnecFtpEnabled(env)) {
    return {
      status: "DISABLED",
      stage: "config",
      durationMs: Date.now() - startedAt,
      message: "1C FTP integration is disabled (ONEC_FTP_ENABLED=false).",
    };
  }

  const loaded = loadOnecFtpConfig(env);
  if (!loaded.ok) {
    return {
      status: "CONFIG_ERROR",
      stage: "config",
      durationMs: Date.now() - startedAt,
      message: loaded.message,
    };
  }

  return probeOnecFtp(loaded.config, options);
}

export function getProbeExitCode(status: OnecFtpProbeStatus): number {
  return status === "SUCCESS" || status === "DISABLED" ? 0 : 1;
}
