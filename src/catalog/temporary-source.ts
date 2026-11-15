import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CatalogImageDeferred } from "./image-deferred";

// Catalogue originals are not user uploads. Never change the upload byte limit.
export const CATALOG_REFERENCE_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const CATALOG_REFERENCE_MAX_PIXELS = 32_000_000;

/** Private, bounded, read-only source staging. Neither filenames nor source bytes
 * are retained after the consumer settles. Backpressure bounds the JS buffer.
 */
export async function withTemporaryCatalogSource<T>(
  expected: number,
  download: (destination: Writable) => Promise<unknown>,
  consume: (sourcePath: string) => Promise<T>,
  onBytes?: (bytes: number) => void,
): Promise<T> {
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > CATALOG_REFERENCE_MAX_SOURCE_BYTES)
    throw new CatalogImageDeferred();
  const directory = await mkdtemp(path.join(tmpdir(), `catalog-source-${process.pid}-`));
  const sourcePath = path.join(directory, "source");
  let seen = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      onBytes?.(chunk.length);
      if (seen > expected || seen > CATALOG_REFERENCE_MAX_SOURCE_BYTES)
        done(new CatalogImageDeferred());
      else done(null, chunk);
    },
  });
  const destination = createWriteStream(sourcePath, { flags: "wx", mode: 0o600 });
  // Attach rejection immediately, including when the FTP writer fails first.
  const copied = pipeline(bounded, destination).then(() => null, (error: unknown) => error);
  try {
    await download(bounded);
    if (!bounded.writableEnded) bounded.end();
    const copyError = await copied;
    if (copyError) throw copyError;
    if (seen !== expected) throw new CatalogImageDeferred();
    return await consume(sourcePath);
  } finally {
    bounded.destroy();
    destination.destroy();
    await copied;
    await rm(directory, { recursive: true, force: true });
  }
}
