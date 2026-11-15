import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Metadata } from "sharp";
import { getPool } from "../db/pool";
import { CatalogImageDeferred } from "./image-deferred";

const LOCK = 718332021;
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_RSS = 160 * 1024 * 1024;
const MIN_AVAILABLE = 64 * 1024 * 1024;
let nativeOutput: Buffer | undefined;
let nativeActive = false;

function availableMemory(): number {
  try {
    const host = Number(readFileSync("/proc/meminfo", "utf8")
      .match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
    // Node 22 accounts for the process/container limit, unlike host meminfo alone.
    return typeof process.availableMemory === "function" ? Math.min(host, process.availableMemory()) : host;
  } catch { throw new CatalogImageDeferred(); }
}

export function catalogFileMemoryAvailable(): boolean {
  try { return process.memoryUsage().rss <= MAX_RSS && availableMemory() >= 96 * 1024 * 1024; }
  catch { return false; }
}

/** One native transform across HTTP and manual CLI processes, without a new table. */
async function acquireLease(): Promise<() => Promise<void>> {
  const pool = getPool();
  if (!pool) {
    if (process.env.NODE_ENV === "production") throw new CatalogImageDeferred();
    return async () => {};
  }
  const db = await pool.connect();
  try {
    if (!(await db.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK])).rows[0]?.ok)
      throw new CatalogImageDeferred();
  } catch { db.release(); throw new CatalogImageDeferred(); }
  return async () => {
    try { await db.query("SELECT pg_advisory_unlock($1)", [LOCK]); }
    catch { db.release(true); throw new CatalogImageDeferred(); }
    db.release();
  };
}

export type JpegNormalizerRuntime = {
  spawn?: typeof spawn;
  timeoutMs?: number;
  acquireLease?: () => Promise<() => Promise<void>>;
};

/** Lossless progressive -> sequential JPEG. Original bytes/files are never changed.
 * jpegtran has no Node/Sharp runtime and exits before libvips decodes its output.
 * No shell, filenames, network access, credentials, or disk intermediates.
 */
export async function normalizeProgressiveJpeg(
  bytes: Buffer, metadata: Metadata, runtime: JpegNormalizerRuntime = {},
): Promise<Buffer | null> {
  if (metadata.format !== "jpeg" || !metadata.isProgressive) return bytes;
  return withNormalizedJpeg(bytes, metadata, async normalized => Buffer.from(normalized), runtime);
}

/** The callback MUST finish consuming input before resolving: this bounded scratch
 * buffer is reused only after both local and database leases have been released.
 * Return derived bytes, never the borrowed input or a view of its backing store.
 */
export async function withNormalizedJpeg<T>(
  bytes: Buffer, metadata: Metadata, consume: (input: Buffer) => Promise<T>,
  runtime: JpegNormalizerRuntime = {},
): Promise<T | null> {
  if (metadata.format !== "jpeg" || !metadata.isProgressive) return consume(bytes);
  return withNativeLease(async () => {
    const normalized = await runJpegtran(bytes, metadata, runtime);
    return Buffer.isBuffer(normalized) ? await consume(normalized) : null;
  }, runtime);
}

/** File-backed originals avoid retaining compressed input and normalized output
 * in the Node heap. The native-only RSS budget is 192 MiB, Node remains 160 MiB,
 * combined remains 288 MiB and available memory must remain at least 96 MiB.
 * This is a separately reviewed catalogue-only policy, not an upload change.
 */
export async function withNormalizedJpegFile<T>(
  sourcePath: string, metadata: Metadata, consume: (normalizedPath: string) => Promise<T>,
  runtime: JpegNormalizerRuntime = {},
): Promise<T | null> {
  return withNativeLease(async () => {
    if (!catalogFileMemoryAvailable()) throw new CatalogImageDeferred();
    if (metadata.format !== "jpeg" || !metadata.isProgressive) return await consume(sourcePath);
    const directory = await mkdtemp(path.join(tmpdir(), `catalog-normalized-${process.pid}-`));
    try {
      const normalized = await runJpegtran(sourcePath, metadata, runtime, path.join(directory, "image.jpg"));
      return typeof normalized === "string" ? await consume(normalized) : null;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, runtime);
}

async function withNativeLease<T>(consume: () => Promise<T>, runtime: JpegNormalizerRuntime) {
  if (nativeActive) throw new CatalogImageDeferred();
  nativeActive = true;
  let release: (() => Promise<void>) | undefined;
  try {
    try { release = await (runtime.acquireLease ?? acquireLease)(); }
    catch { throw new CatalogImageDeferred(); }
    return await consume();
  }
  finally {
    try { await release?.(); } catch { throw new CatalogImageDeferred(); }
    finally { nativeActive = false; }
  }
}

async function runJpegtran(
  input: Buffer | string, metadata: Metadata, runtime: JpegNormalizerRuntime, outputFile?: string,
): Promise<Buffer | string | null> {
  const fileBacked = typeof input === "string";
  const nativeLimit = fileBacked ? 192 * 1024 * 1024 : MAX_RSS;
  const minimumAvailable = fileBacked ? 96 * 1024 * 1024 : MIN_AVAILABLE;
  if (process.platform === "linux") {
      const available = availableMemory();
      // Progressive JPEG needs its DCT coefficients even for a tiny output.
      // Reserve a conservative full-resolution estimate before starting a child.
      const coefficients = Math.ceil((metadata.width ?? 0) / 8) * 8 *
        Math.ceil((metadata.height ?? 0) / 8) * 8 * (metadata.channels ?? 4) * 2;
      if (!Number.isFinite(available) || available < coefficients + 16 * 1024 * 1024 + minimumAvailable ||
          process.memoryUsage().rss > MAX_RSS) throw new CatalogImageDeferred();
  }
  return await new Promise<Buffer | string | null>((resolve, reject) => {
      // One allocation per process, touching only received bytes. The lease
      // extends through Sharp consumption, so no other request can overwrite it.
      const output = fileBacked ? undefined : (nativeOutput ??= Buffer.allocUnsafeSlow(MAX_OUTPUT));
      let child: ChildProcessWithoutNullStreams;
      try {
        child = (runtime.spawn ?? spawn)("/usr/bin/jpegtran",
          ["-copy", "all", "-strict", "-maxmemory", fileBacked ? "196m" : "152m"],
          { shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C" }, stdio: "pipe" }) as ChildProcessWithoutNullStreams;
      } catch { reject(new CatalogImageDeferred()); return; }
      let size = 0, stderr = "", deferred = false, closed = false;
      let source: ReturnType<typeof createReadStream> | undefined;
      let destination: ReturnType<typeof createWriteStream> | undefined;
      const stop = () => {
        deferred = true; source?.destroy(); destination?.destroy(); child.kill("SIGKILL");
      };
      const guard = () => {
        if (closed || deferred) return;
        try {
          if (process.platform !== "linux") return;
          const available = availableMemory();
          const rss = Number(readFileSync(`/proc/${child.pid}/status`, "utf8")
            .match(/^VmRSS:\s+(\d+)/m)?.[1]) * 1024;
          const parent = process.memoryUsage().rss;
          if (!Number.isFinite(available) || available < minimumAvailable ||
              rss > nativeLimit || parent > MAX_RSS ||
              (fileBacked && parent + rss > 288 * 1024 * 1024)) stop();
        } catch (error) {
          // A short-lived child may disappear before its close event arrives.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") stop();
        }
      };
      const timer = setTimeout(stop, runtime.timeoutMs ?? 10_000);
      const monitor = setInterval(guard, 20);
      let written: Promise<boolean> = Promise.resolve(true);
      if (fileBacked && outputFile) {
        destination = createWriteStream(outputFile, { flags: "wx", mode: 0o600 });
        const bounded = new Transform({ transform(part: Buffer, _encoding, done) {
          size += part.length;
          if (size > 64 * 1024 * 1024) { stop(); done(new CatalogImageDeferred()); }
          else done(null, part);
        } });
        written = pipeline(child.stdout, bounded, destination).then(() => true, () => { stop(); return false; });
      } else child.stdout.on("data", (part: Buffer) => {
        size += part.length;
        if (size > MAX_OUTPUT) { stop(); return; }
        part.copy(output!, size - part.length);
      });
      child.stderr.on("data", (part: Buffer) => { stderr = (stderr + part.toString()).slice(0, 4096); });
      child.stdin.on("error", () => { source?.destroy(); /* EPIPE is settled by close/error. */ });
      child.on("error", () => { deferred = true; });
      child.on("close", async (code, signal) => {
        closed = true; source?.destroy();
        const complete = await written;
        clearTimeout(timer); clearInterval(monitor);
        if (!complete || deferred || signal || /memory|backing store/i.test(stderr)) reject(new CatalogImageDeferred());
        else if (code !== 0 || !size) resolve(null);
        else resolve(fileBacked ? outputFile! : output!.subarray(0, size));
      });
      guard();
      if (!deferred) {
        if (typeof input === "string") {
          source = createReadStream(input);
          source.on("error", stop);
          source.pipe(child.stdin);
        } else child.stdin.end(input);
      }
    }).catch(() => { throw new CatalogImageDeferred(); });
}
