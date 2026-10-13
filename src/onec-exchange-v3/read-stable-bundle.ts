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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLocalFileMeta(filePath: string): Promise<{ sizeBytes: number; mtimeMs: number }> {
  const stat = await fs.stat(filePath);
  return { sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

async function readLocalBounded(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size > V3_MAX_FILE_BYTES) {
      throw new Error("FILE_TOO_LARGE");
    }
    const buffer = Buffer.alloc(stat.size);
    await handle.read(buffer, 0, stat.size, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function readLocalBundleTwice(bundleDir: string): Promise<StableV3BundleRead> {
  const files = [
    V3_BUNDLE_FILES.holdings,
    V3_BUNDLE_FILES.clients,
    V3_BUNDLE_FILES.retail,
    V3_BUNDLE_FILES.employees,
  ];
  const firstMeta: V3FileMeta[] = [];
  const firstBytes: Buffer[] = [];
  for (const fileName of files) {
    const filePath = path.join(bundleDir, fileName);
    const bytes = await readLocalBounded(filePath);
    firstBytes.push(bytes);
    firstMeta.push({ fileName, sizeBytes: bytes.length, sha256: sha256Buffer(bytes) });
  }

  await sleep(STABILITY_DELAY_MS);

  for (let i = 0; i < files.length; i += 1) {
    const filePath = path.join(bundleDir, files[i]!);
    const meta = await readLocalFileMeta(filePath);
    if (meta.sizeBytes !== firstMeta[i]!.sizeBytes) {
      return { ok: false, code: "BUNDLE_UNSTABLE", message: `${files[i]} changed size during stability window` };
    }
    const bytes = await readLocalBounded(filePath);
    if (sha256Buffer(bytes) !== firstMeta[i]!.sha256) {
      return { ok: false, code: "BUNDLE_UNSTABLE", message: `${files[i]} hash changed during stability window` };
    }
  }

  const bundleSha256 = Object.fromEntries(firstMeta.map((m) => [m.fileName, m.sha256]));
  return {
    ok: true,
    bundle: {
      holdingsBytes: firstBytes[0]!,
      clientsBytes: firstBytes[1]!,
      retailBytes: firstBytes[2]!,
      employeesBytes: firstBytes[3]!,
    },
    fileMeta: firstMeta,
    bundleSha256,
  };
}

async function readFtpFileTwice(config: OnecFtpConfig, fileName: string): Promise<
  | { ok: true; bytes: Buffer; meta: V3FileMeta }
  | { ok: false; code: string; message: string }
> {
  const remotePath = `${config.basePath.replace(/\/$/, "")}/${V3_FTP_CLIENTS_DIR}/${fileName}`;
  const first = await readRemoteFileFromFtp(config, remotePath, V3_MAX_FILE_BYTES);
  if (!first.ok) {
    return { ok: false, code: first.code, message: `${fileName}: ${first.message}` };
  }
  const firstHash = sha256Buffer(first.bytes);
  await sleep(STABILITY_DELAY_MS);
  const second = await readRemoteFileFromFtp(config, remotePath, V3_MAX_FILE_BYTES);
  if (!second.ok) {
    return { ok: false, code: second.code, message: `${fileName}: ${second.message}` };
  }
  const secondHash = sha256Buffer(second.bytes);
  if (firstHash !== secondHash || first.bytes.length !== second.bytes.length) {
    return { ok: false, code: "BUNDLE_UNSTABLE", message: `${fileName} unstable between reads` };
  }
  return {
    ok: true,
    bytes: second.bytes,
    meta: { fileName, sizeBytes: second.bytes.length, sha256: secondHash },
  };
}

export async function readStableV3Bundle(input: {
  bundleDir?: string;
  ftpConfig?: OnecFtpConfig;
}): Promise<StableV3BundleRead> {
  if (input.bundleDir) {
    return readLocalBundleTwice(input.bundleDir);
  }
  if (!input.ftpConfig) {
    return { ok: false, code: "CONFIG_ERROR", message: "bundleDir or ftpConfig required" };
  }
  const fileMeta: V3FileMeta[] = [];
  const bundle: Partial<V3BundleBytes> = {};
  for (const [key, fileName] of [
    ["holdingsBytes", V3_BUNDLE_FILES.holdings],
    ["clientsBytes", V3_BUNDLE_FILES.clients],
    ["retailBytes", V3_BUNDLE_FILES.retail],
    ["employeesBytes", V3_BUNDLE_FILES.employees],
  ] as const) {
    const read = await readFtpFileTwice(input.ftpConfig, fileName);
    if (!read.ok) {
      return read;
    }
    bundle[key] = read.bytes;
    fileMeta.push(read.meta);
  }
  const bundleSha256 = Object.fromEntries(fileMeta.map((m) => [m.fileName, m.sha256]));
  return {
    ok: true,
    bundle: bundle as V3BundleBytes,
    fileMeta,
    bundleSha256,
  };
}

/** Convenience when stable read not required (tests with injected bytes). */
export { readV3BundleFromDirectory };
