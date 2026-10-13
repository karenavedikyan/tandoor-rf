import type { OnecFtpConfig } from "../onec-ftp/types";
import { readRemoteFileFromFtp } from "../onec-clients/ftp-read";
import { V3_BUNDLE_FILES, V3_FTP_CLIENTS_DIR, V3_MAX_FILE_BYTES } from "./constants";
import { sha256Buffer } from "./bundle-fingerprint";
import { readV3BundleFromDirectory, type V3BundleBytes } from "./read-bundle";
import fs from "node:fs/promises";
import path from "node:path";

export type V3FileMeta = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  mtimeMs?: number;
};

export type StableV3BundleRead =
  | {
      ok: true;
      bundle: V3BundleBytes;
      fileMeta: V3FileMeta[];
      bundleSha256: Record<string, string>;
    }
  | { ok: false; code: string; message: string };

const STABILITY_DELAY_MS = 400;
/** Whole-bundle stability window (both passes + delay). */
export const V3_BUNDLE_READ_DEADLINE_MS = 120_000;

const BUNDLE_FILE_ORDER = [
  V3_BUNDLE_FILES.holdings,
  V3_BUNDLE_FILES.clients,
  V3_BUNDLE_FILES.retail,
  V3_BUNDLE_FILES.employees,
] as const;

export type StableV3BundleTestHooks = {
  afterFileRead?: (input: { fileName: string; pass: 1 | 2 }) => Promise<void>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertWithinDeadline(deadlineAt: number): void {
  if (Date.now() > deadlineAt) {
    throw new Error("TIMEOUT");
  }
}

type LocalFileSnapshot = {
  fileName: string;
  bytes: Buffer;
  sizeBytes: number;
  sha256: string;
  mtimeMs: number;
};

async function readLocalFileMeta(filePath: string): Promise<{ sizeBytes: number; mtimeMs: number }> {
  const stat = await fs.stat(filePath);
  return { sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

/** Read entire file with partial-read handling; detect size/metadata drift while reading. */
async function readLocalFileFully(
  filePath: string,
  deadlineAt: number,
): Promise<LocalFileSnapshot> {
  assertWithinDeadline(deadlineAt);
  const fileName = path.basename(filePath);
  const initialStat = await fs.stat(filePath);
  if (initialStat.size > V3_MAX_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  const handle = await fs.open(filePath, "r");
  try {
    const expectedSize = initialStat.size;
    const expectedMtime = initialStat.mtimeMs;
    const buffer = Buffer.alloc(expectedSize);
    let offset = 0;

    while (offset < expectedSize) {
      assertWithinDeadline(deadlineAt);
      const { bytesRead } = await handle.read(buffer, offset, expectedSize - offset, offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
      const live = await fs.stat(filePath);
      if (live.size !== expectedSize || live.mtimeMs !== expectedMtime) {
        throw new Error("BUNDLE_UNSTABLE");
      }
    }

    if (offset !== expectedSize) {
      throw new Error("BUNDLE_UNSTABLE");
    }

    const bytes = buffer.subarray(0, offset);
    return {
      fileName,
      bytes,
      sizeBytes: bytes.length,
      sha256: sha256Buffer(bytes),
      mtimeMs: expectedMtime,
    };
  } finally {
    await handle.close();
  }
}

type BundlePass = {
  files: LocalFileSnapshot[];
};

function compareBundlePasses(first: BundlePass, second: BundlePass): string | null {
  if (first.files.length !== second.files.length) {
    return "bundle pass file count mismatch";
  }
  for (let i = 0; i < first.files.length; i += 1) {
    const a = first.files[i]!;
    const b = second.files[i]!;
    if (a.fileName !== b.fileName) {
      return "bundle file order mismatch";
    }
    if (a.sizeBytes !== b.sizeBytes) {
      return `${a.fileName} changed size between stability passes`;
    }
    if (a.sha256 !== b.sha256) {
      return `${a.fileName} hash changed between stability passes`;
    }
  }
  return null;
}

function passToBundle(pass: BundlePass): V3BundleBytes {
  const byName = Object.fromEntries(pass.files.map((f) => [f.fileName, f.bytes]));
  return {
    holdingsBytes: byName[V3_BUNDLE_FILES.holdings]!,
    clientsBytes: byName[V3_BUNDLE_FILES.clients]!,
    retailBytes: byName[V3_BUNDLE_FILES.retail]!,
    employeesBytes: byName[V3_BUNDLE_FILES.employees]!,
  };
}

function passToMeta(pass: BundlePass): V3FileMeta[] {
  return pass.files.map((f) => ({
    fileName: f.fileName,
    sizeBytes: f.sizeBytes,
    sha256: f.sha256,
    mtimeMs: f.mtimeMs,
  }));
}

async function readLocalPass(
  bundleDir: string,
  pass: 1 | 2,
  deadlineAt: number,
  testHooks?: StableV3BundleTestHooks,
): Promise<BundlePass> {
  const files: LocalFileSnapshot[] = [];
  for (const fileName of BUNDLE_FILE_ORDER) {
    const filePath = path.join(bundleDir, fileName);
    const beforeMeta = await readLocalFileMeta(filePath);
    const snapshot = await readLocalFileFully(filePath, deadlineAt);
    const afterMeta = await readLocalFileMeta(filePath);
    if (
      beforeMeta.sizeBytes !== afterMeta.sizeBytes ||
      beforeMeta.mtimeMs !== afterMeta.mtimeMs ||
      beforeMeta.sizeBytes !== snapshot.sizeBytes
    ) {
      throw new Error("BUNDLE_UNSTABLE");
    }
    files.push(snapshot);
    await testHooks?.afterFileRead?.({ fileName, pass });
  }
  return { files };
}

async function readLocalBundleTwoPass(
  bundleDir: string,
  testHooks?: StableV3BundleTestHooks,
): Promise<StableV3BundleRead> {
  const deadlineAt = Date.now() + V3_BUNDLE_READ_DEADLINE_MS;
  try {
    const first = await readLocalPass(bundleDir, 1, deadlineAt, testHooks);
    await sleep(STABILITY_DELAY_MS);
    assertWithinDeadline(deadlineAt);
    const second = await readLocalPass(bundleDir, 2, deadlineAt, testHooks);
    const drift = compareBundlePasses(first, second);
    if (drift) {
      return { ok: false, code: "BUNDLE_UNSTABLE", message: drift };
    }
    const fileMeta = passToMeta(second);
    return {
      ok: true,
      bundle: passToBundle(second),
      fileMeta,
      bundleSha256: Object.fromEntries(fileMeta.map((m) => [m.fileName, m.sha256])),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TIMEOUT") {
      return { ok: false, code: "TIMEOUT", message: "Bundle stability read exceeded deadline" };
    }
    if (message === "FILE_TOO_LARGE") {
      return { ok: false, code: "FILE_TOO_LARGE", message: "One of bundle files exceeds size limit" };
    }
    if (message === "BUNDLE_UNSTABLE") {
      return { ok: false, code: "BUNDLE_UNSTABLE", message: "Bundle changed during stability window" };
    }
    throw error;
  }
}

type FtpFileSnapshot = {
  fileName: string;
  bytes: Buffer;
  sizeBytes: number;
  sha256: string;
};

async function readFtpPass(
  config: OnecFtpConfig,
  pass: 1 | 2,
  deadlineAt: number,
  testHooks?: StableV3BundleTestHooks,
): Promise<{ files: FtpFileSnapshot[] }> {
  const files: FtpFileSnapshot[] = [];
  const base = config.basePath.replace(/\/$/, "");
  for (const fileName of BUNDLE_FILE_ORDER) {
    assertWithinDeadline(deadlineAt);
    const remotePath = `${base}/${V3_FTP_CLIENTS_DIR}/${fileName}`;
    const read = await readRemoteFileFromFtp(config, remotePath, V3_MAX_FILE_BYTES);
    if (!read.ok) {
      throw new Error(`${read.code}:${fileName}:${read.message}`);
    }
    files.push({
      fileName,
      bytes: read.bytes,
      sizeBytes: read.bytes.length,
      sha256: sha256Buffer(read.bytes),
    });
    await testHooks?.afterFileRead?.({ fileName, pass });
  }
  return { files };
}

function compareFtpPasses(
  first: { files: FtpFileSnapshot[] },
  second: { files: FtpFileSnapshot[] },
): string | null {
  return compareBundlePasses(
    { files: first.files.map((f) => ({ ...f, mtimeMs: 0 })) },
    { files: second.files.map((f) => ({ ...f, mtimeMs: 0 })) },
  );
}

async function readFtpBundleTwoPass(
  config: OnecFtpConfig,
  testHooks?: StableV3BundleTestHooks,
): Promise<StableV3BundleRead> {
  const deadlineAt = Date.now() + V3_BUNDLE_READ_DEADLINE_MS;
  try {
    const first = await readFtpPass(config, 1, deadlineAt, testHooks);
    await sleep(STABILITY_DELAY_MS);
    assertWithinDeadline(deadlineAt);
    const second = await readFtpPass(config, 2, deadlineAt, testHooks);
    const drift = compareFtpPasses(first, second);
    if (drift) {
      return { ok: false, code: "BUNDLE_UNSTABLE", message: drift };
    }
    const fileMeta: V3FileMeta[] = second.files.map((f) => ({
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
    }));
    const byName = Object.fromEntries(second.files.map((f) => [f.fileName, f.bytes]));
    return {
      ok: true,
      bundle: {
        holdingsBytes: byName[V3_BUNDLE_FILES.holdings]!,
        clientsBytes: byName[V3_BUNDLE_FILES.clients]!,
        retailBytes: byName[V3_BUNDLE_FILES.retail]!,
        employeesBytes: byName[V3_BUNDLE_FILES.employees]!,
      },
      fileMeta,
      bundleSha256: Object.fromEntries(fileMeta.map((m) => [m.fileName, m.sha256])),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TIMEOUT") {
      return { ok: false, code: "TIMEOUT", message: "Bundle stability read exceeded deadline" };
    }
    if (message.startsWith("FTP_") || message.includes(":FTP_")) {
      return { ok: false, code: "FTP_ERROR", message };
    }
    if (message.includes("FILE_TOO_LARGE")) {
      return { ok: false, code: "FILE_TOO_LARGE", message };
    }
    return { ok: false, code: "FTP_ERROR", message };
  }
}

export async function readStableV3Bundle(input: {
  bundleDir?: string;
  ftpConfig?: OnecFtpConfig;
  testHooks?: StableV3BundleTestHooks;
}): Promise<StableV3BundleRead> {
  if (input.bundleDir) {
    return readLocalBundleTwoPass(input.bundleDir, input.testHooks);
  }
  if (!input.ftpConfig) {
    return { ok: false, code: "CONFIG_ERROR", message: "bundleDir or ftpConfig required" };
  }
  return readFtpBundleTwoPass(input.ftpConfig, input.testHooks);
}

/** Convenience when stable read not required (tests with injected bytes). */
export { readV3BundleFromDirectory };
