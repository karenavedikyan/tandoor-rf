import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import { getMaxImageBytes, processImageToPreview } from "../catalog/image-storage";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { safeImagePath } from "./model";

type PhotoClient = Pick<Client, "access" | "size" | "downloadTo" | "close">;

/** One read-only transfer, using existing server credentials. Never runs an import. */
export async function readFtpPhoto(
  sourcePath: string,
  makeClient: (timeout: number) => PhotoClient = timeout => new Client(timeout),
  deadlineMs = 15_000,
): Promise<Buffer | null> {
  const relative = safeImagePath(sourcePath);
  const loaded = loadOnecFtpConfig();
  if (!relative || !loaded.ok) return null;
  const config = loaded.config;
  const client = makeClient(Math.min(config.timeoutMs, deadlineMs));
  const limit = Math.min(getMaxImageBytes(), 8 * 1024 * 1024);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.access({ host: config.host, port: config.port, user: config.user,
          password: config.password, secure: false });
        const remote = `/s3/IMG/${relative}`;
        const expected = await client.size(remote);
        if (!Number.isSafeInteger(expected) || expected <= 0 || expected > limit) return null;
        const chunks: Buffer[] = [];
        let seen = 0;
        await client.downloadTo(new Writable({ write(chunk: Buffer, _encoding, done) {
          seen += chunk.length;
          if (seen > expected || seen > limit) { done(new Error("IMAGE_SIZE_LIMIT")); return; }
          chunks.push(Buffer.from(chunk)); done();
        } }), remote);
        if (seen !== expected) return null;
        const result = await processImageToPreview(Buffer.concat(chunks));
        return result.ok ? result.previewBuffer : null;
      })(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => { client.close(); resolve(null); }, deadlineMs);
      }),
    ]);
  } catch {
    // No paths, credentials or raw upstream error messages enter the API.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    client.close();
  }
}
