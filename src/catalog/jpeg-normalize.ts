import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
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
  if (nativeActive) throw new CatalogImageDeferred();
  nativeActive = true;
  let release: (() => Promise<void>) | undefined;
  try {
    try { release = await (runtime.acquireLease ?? acquireLease)(); }
    catch { throw new CatalogImageDeferred(); }
    if (process.platform === "linux") {
      const available = availableMemory();
      // Progressive JPEG needs its DCT coefficients even for a tiny output.
      // Reserve a conservative full-resolution estimate before starting a child.
      const coefficients = Math.ceil((metadata.width ?? 0) / 8) * 8 *
        Math.ceil((metadata.height ?? 0) / 8) * 8 * (metadata.channels ?? 4) * 2;
      if (!Number.isFinite(available) || available < coefficients + 16 * 1024 * 1024 + MIN_AVAILABLE ||
          process.memoryUsage().rss > MAX_RSS) throw new CatalogImageDeferred();
    }
    const normalized = await new Promise<Buffer | null>((resolve, reject) => {
      // One allocation per process, touching only received bytes. The lease
      // extends through Sharp consumption, so no other request can overwrite it.
      const output = nativeOutput ??= Buffer.allocUnsafeSlow(MAX_OUTPUT);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = (runtime.spawn ?? spawn)("/usr/bin/jpegtran",
          ["-copy", "all", "-strict", "-maxmemory", "152m"],
          { shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C" }, stdio: "pipe" }) as ChildProcessWithoutNullStreams;
      } catch { reject(new CatalogImageDeferred()); return; }
      let size = 0, stderr = "", deferred = false, closed = false;
      const stop = () => { deferred = true; child.kill("SIGKILL"); };
      const guard = () => {
        if (closed || deferred) return;
        try {
          if (process.platform !== "linux") return;
          const available = availableMemory();
          const rss = Number(readFileSync(`/proc/${child.pid}/status`, "utf8")
            .match(/^VmRSS:\s+(\d+)/m)?.[1]) * 1024;
          if (!Number.isFinite(available) || available < MIN_AVAILABLE ||
              rss > MAX_RSS || process.memoryUsage().rss > MAX_RSS) stop();
        } catch (error) {
          // A short-lived child may disappear before its close event arrives.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") stop();
        }
      };
      const timer = setTimeout(stop, runtime.timeoutMs ?? 10_000);
      const monitor = setInterval(guard, 20);
      child.stdout.on("data", (part: Buffer) => {
        size += part.length;
        if (size > MAX_OUTPUT) { stop(); return; }
        part.copy(output, size - part.length);
      });
      child.stderr.on("data", (part: Buffer) => { stderr = (stderr + part.toString()).slice(0, 4096); });
      child.stdin.on("error", () => { /* EPIPE is settled by close/error, never an unhandled exception. */ });
      child.on("error", () => { deferred = true; });
      child.on("close", (code, signal) => {
        closed = true; clearTimeout(timer); clearInterval(monitor);
        if (deferred || signal || /memory|backing store/i.test(stderr)) reject(new CatalogImageDeferred());
        else if (code !== 0 || !size) resolve(null);
        else resolve(output.subarray(0, size));
      });
      guard();
      if (!deferred) child.stdin.end(bytes);
    }).catch(() => { throw new CatalogImageDeferred(); });
    return normalized ? await consume(normalized) : null;
  }
  finally {
    try { await release?.(); } catch { throw new CatalogImageDeferred(); }
    finally { nativeActive = false; }
  }
}
