import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import { getMaxImageBytes, processCatalogReferenceToPreview } from "../catalog/image-storage";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { safeImagePath } from "./model";

type PhotoClient = Pick<Client, "access" | "size" | "downloadTo" | "close">;

/** One read-only transfer, using existing server credentials. Never runs an import. */
export async function readFtpPhoto(
  sourcePath: string,
  makeClient: (timeout: number) => PhotoClient = timeout => new Client(timeout),
  deadlineMs = 15_000,
): Promise<Buffer | null> {
  const session = createFtpPhotoSession(makeClient, deadlineMs);
  try { return await session.read(sourcePath); } finally { session.close(); }
}

/** A manual batch reuses one connection. Viewing a photo still closes its session.
 * A failed/stalled transfer closes the socket and the next read reconnects.
 */
export function createFtpPhotoSession(
  makeClient: (timeout: number) => PhotoClient = timeout => new Client(timeout),
  deadlineMs = 15_000,
) {
  let client: PhotoClient | undefined, connected = false, sourceBytes = 0;
  function close() { client?.close(); client = undefined; connected = false; }
  async function read(sourcePath: string): Promise<Buffer | null> {
    const relative = safeImagePath(sourcePath), loaded = loadOnecFtpConfig();
    if (!relative || !loaded.ok) return null;
    const config = loaded.config;
    client ??= makeClient(Math.min(config.timeoutMs, deadlineMs));
    const current = client;
    const limit = Math.min(getMaxImageBytes(), 8 * 1024 * 1024);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (!connected) {
            await current.access({ host: config.host, port: config.port, user: config.user,
              password: config.password, secure: false });
            connected = true;
          }
          const remote = `/s3/IMG/${relative}`;
          const expected = await current.size(remote);
          if (!Number.isSafeInteger(expected) || expected <= 0 || expected > limit) return null;
          const chunks: Buffer[] = [];
          let seen = 0;
          await current.downloadTo(new Writable({ write(chunk: Buffer, _encoding, done) {
            seen += chunk.length;
            sourceBytes += chunk.length;
            if (seen > expected || seen > limit) { done(new Error("IMAGE_SIZE_LIMIT")); return; }
            chunks.push(Buffer.from(chunk)); done();
          } }), remote);
          if (seen !== expected) return null;
          const result = await processCatalogReferenceToPreview(Buffer.concat(chunks));
          return result.ok ? result.previewBuffer : null;
        })(),
        new Promise<null>(resolve => {
          timer = setTimeout(() => { close(); resolve(null); }, deadlineMs);
        }),
      ]);
    } catch {
      // No paths, credentials or raw upstream error messages enter the API.
      close(); return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { read, close, get sourceBytes() { return sourceBytes; } };
}
