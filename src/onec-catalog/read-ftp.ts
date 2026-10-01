import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import type { OnecFtpConfig } from "../onec-ftp/types";
import {
  CATALOG_RELATIVE_FILES,
  FTP_READ_DEADLINE_MS,
  MAX_CATALOG_FILE_BYTES,
  MAX_CATALOG_SET_BYTES,
} from "./constants";
import { buildCatalogFilePath } from "./paths";
import { buildFileEntries } from "./manifest";
import type { CatalogFileEntry, ValidationIssue } from "./types";

class SizeLimitedBuffer extends Writable {
  private readonly chunks: Buffer[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.total += chunk.length;
    if (this.total > this.maxBytes) {
      callback(new Error("FILE_TOO_LARGE"));
      return;
    }
    this.chunks.push(chunk);
    callback();
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

class ReadDeadlineError extends Error {
  constructor() {
    super("FTP read timed out.");
    this.name = "ReadDeadlineError";
  }
}

export type CatalogFtpReadResult =
  | { ok: true; files: CatalogFileEntry[] }
  | { ok: false; code: "TIMEOUT" | "FTP_ERROR" | "FILE_TOO_LARGE"; message: string; issues?: ValidationIssue[] };

export type CatalogFtpReader = (
  config: OnecFtpConfig,
  context?: { readDeadlineMs?: number },
) => Promise<CatalogFtpReadResult>;

async function withReadDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ReadDeadlineError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const defaultCatalogFtpReader: CatalogFtpReader = async (config, context) => {
  const readDeadlineMs = context?.readDeadlineMs ?? FTP_READ_DEADLINE_MS;
  const client = new Client(config.timeoutMs);
  client.ftp.verbose = false;

  try {
    return await withReadDeadline(
      (async () => {
        await client.access({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          secure: false,
        });

        const inputs: Array<{ relativePath: (typeof CATALOG_RELATIVE_FILES)[number]; bytes: Buffer }> = [];
        let totalBytes = 0;
        for (const relativePath of CATALOG_RELATIVE_FILES) {
          const remotePath = buildCatalogFilePath(config.basePath, relativePath);
          const sink = new SizeLimitedBuffer(MAX_CATALOG_FILE_BYTES);
          await client.downloadTo(sink, remotePath);
          const bytes = sink.toBuffer();
          totalBytes += bytes.length;
          if (totalBytes > MAX_CATALOG_SET_BYTES) {
            return {
              ok: false as const,
              code: "FILE_TOO_LARGE" as const,
              message: "Catalog file set exceeds total byte limit.",
            };
          }
          inputs.push({ relativePath, bytes });
        }
        return { ok: true as const, files: buildFileEntries(inputs) };
      })(),
      readDeadlineMs,
    );
  } catch (error) {
    if (error instanceof ReadDeadlineError) {
      return { ok: false, code: "TIMEOUT", message: "FTP read timed out." };
    }
    const message = error instanceof Error ? error.message : "FTP read failed.";
    if (/FILE_TOO_LARGE/i.test(message)) {
      return { ok: false, code: "FILE_TOO_LARGE", message: "Catalog file exceeds allowed size limit." };
    }
    return { ok: false, code: "FTP_ERROR", message: "FTP read failed." };
  } finally {
    client.close();
  }
};

export async function readCatalogSetFromFtp(
  config: OnecFtpConfig,
  reader: CatalogFtpReader = defaultCatalogFtpReader,
  context?: { readDeadlineMs?: number },
): Promise<CatalogFtpReadResult> {
  return reader(config, context);
}
