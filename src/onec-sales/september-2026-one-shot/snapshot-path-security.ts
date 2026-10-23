import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const SNAPSHOT_MAX_FILE_BYTES = 32 * 1024 * 1024;

export async function assertSnapshotDirectorySecurity(
  directory: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const root = resolve(directory);
  try {
    const stat = await lstat(root);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "SNAPSHOT_SYMLINK", message: "Snapshot directory must not be a symlink." };
    }
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      return { ok: false, code: "SNAPSHOT_DIR_NOT_PRIVATE", message: "Snapshot directory must be mode 0700." };
    }
  } catch {
    return { ok: false, code: "SNAPSHOT_DIR_MISSING", message: "Snapshot directory missing." };
  }
  return { ok: true };
}

export async function readSnapshotFileSecure(
  directory: string,
  fileName: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: string; message: string }> {
  const root = resolve(directory);
  const filePath = resolve(root, fileName);
  if (dirname(filePath) !== root && !filePath.startsWith(`${root}/`)) {
    return { ok: false, code: "SNAPSHOT_PATH_ESCAPE", message: "Snapshot path escapes directory." };
  }
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "SNAPSHOT_SYMLINK", message: `${fileName} must not be a symlink.` };
    }
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      return { ok: false, code: "SNAPSHOT_FILE_NOT_PRIVATE", message: `${fileName} must be mode 0600.` };
    }
    if (stat.size > SNAPSHOT_MAX_FILE_BYTES) {
      return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: `${fileName} exceeds 32MiB bound.` };
    }
    const bytes = await readFile(filePath);
    if (bytes.length > SNAPSHOT_MAX_FILE_BYTES) {
      return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: `${fileName} exceeds 32MiB bound.` };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "SOURCE_FILE_MISSING", message: `Missing snapshot file ${fileName}.` };
  }
}
