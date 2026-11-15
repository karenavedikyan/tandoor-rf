import { Client } from "basic-ftp";
import { processCatalogReferenceFileToPreview } from "../catalog/image-storage";
import { CATALOG_REFERENCE_MAX_SOURCE_BYTES, withTemporaryCatalogSource } from "../catalog/temporary-source";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { safeImagePath } from "./model";
import { CatalogImageDeferred } from "../catalog/image-deferred";

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
    if (!relative) return null;
    if (!loaded.ok) throw new CatalogImageDeferred();
    const config = loaded.config;
    client ??= makeClient(Math.min(config.timeoutMs, deadlineMs));
    const current = client;
    const limit = CATALOG_REFERENCE_MAX_SOURCE_BYTES;
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
          const result = await withTemporaryCatalogSource(expected, async destination => {
            await current.downloadTo(destination, remote);
          }, processCatalogReferenceFileToPreview, bytes => { sourceBytes += bytes; });
          return result.ok ? result.previewBuffer : null;
        })(),
        new Promise<null>((_resolve, reject) => {
          timer = setTimeout(() => { close(); reject(new CatalogImageDeferred()); }, deadlineMs);
        }),
      ]);
    } catch (error) {
      // No paths, credentials or raw upstream error messages enter the API.
      close();
      // 550 is a completed FTP negative response, not a connection/timeout failure.
      if ((error as { code?: number }).code === 550) return null;
      throw new CatalogImageDeferred();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { read, close, get sourceBytes() { return sourceBytes; } };
}
