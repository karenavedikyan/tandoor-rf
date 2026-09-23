import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import type { OnecFtpConfig } from "../onec-ftp/types";
import { MAX_SOURCE_BYTES, FTP_READ_DEADLINE_MS } from "./constants";
import { buildClientsFilePath } from "./path";

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

export type FtpReadResult =
  | { ok: true; bytes: Buffer; remotePath: string }
  | { ok: false; code: "TIMEOUT" | "FILE_TOO_LARGE" | "FTP_ERROR"; message: string };

export type FtpReader = (config: OnecFtpConfig) => Promise<FtpReadResult>;

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
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const defaultFtpReader: FtpReader = async (config) => {
  const remotePath = buildClientsFilePath(config.basePath);
  const client = new Client(config.timeoutMs);
  client.ftp.verbose = false;

  const readDeadlineMs = Math.min(config.timeoutMs, FTP_READ_DEADLINE_MS);

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

        const sink = new SizeLimitedBuffer(MAX_SOURCE_BYTES);
        await client.downloadTo(sink, remotePath);
        return { ok: true as const, bytes: sink.toBuffer(), remotePath };
      })(),
      readDeadlineMs,
    );
  } catch (error) {
    if (error instanceof ReadDeadlineError) {
      return { ok: false, code: "TIMEOUT", message: "FTP read timed out." };
    }
    const message = error instanceof Error ? error.message : "FTP read failed.";
    if (/FILE_TOO_LARGE/i.test(message)) {
      return { ok: false, code: "FILE_TOO_LARGE", message: "Source file exceeds the allowed size limit." };
    }
    return { ok: false, code: "FTP_ERROR", message: "FTP read failed." };
  } finally {
    client.close();
  }
};

export async function readClientsFileFromFtp(
  config: OnecFtpConfig,
  reader: FtpReader = defaultFtpReader,
): Promise<FtpReadResult> {
  return reader(config);
}
