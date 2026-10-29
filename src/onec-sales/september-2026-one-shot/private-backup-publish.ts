import { createHash } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

export function formatPrivateBackupFileText(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function assertApprovedPrivateBackupRoot(
  approvedRoot: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const root = resolve(approvedRoot);
    const stat = await lstat(root);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_SYMLINK", message: "Backup private root must not be a symlink." };
    }
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_NOT_PRIVATE", message: "Backup private root must be mode 0700." };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "BACKUP_PRIVATE_ROOT_MISSING", message: "Backup private root directory missing." };
  }
}

async function assertPrivatePathUnderRoot(destinationPath: string, approvedRoot: string): Promise<void> {
  const root = resolve(approvedRoot);
  const dest = resolve(destinationPath);
  if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
    throw new Error("CAPTURE_DESTINATION_OUTSIDE_ROOT");
  }
  const rootCheck = await assertApprovedPrivateBackupRoot(approvedRoot);
  if (!rootCheck.ok) {
    throw new Error(rootCheck.code);
  }
}

export async function publishPrivateBackupJson(input: {
  destinationPath: string;
  approvedPrivateRoot: string;
  payload: unknown;
}): Promise<{ ok: true; fileSha256: string } | { ok: false; code: string; message: string }> {
  try {
    await assertPrivatePathUnderRoot(input.destinationPath, input.approvedPrivateRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid destination.";
    if (
      message === "BACKUP_PRIVATE_ROOT_SYMLINK" ||
      message === "BACKUP_PRIVATE_ROOT_NOT_PRIVATE" ||
      message === "BACKUP_PRIVATE_ROOT_MISSING" ||
      message === "CAPTURE_DESTINATION_OUTSIDE_ROOT"
    ) {
      return { ok: false, code: message, message: "Backup private root or destination invalid." };
    }
    return {
      ok: false,
      code: "BACKUP_DESTINATION_INVALID",
      message,
    };
  }
  const text = formatPrivateBackupFileText(input.payload);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(input.destinationPath, "wx", 0o600);
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = await readFile(input.destinationPath, "utf8");
    const fileSha256 = createHash("sha256").update(readback).digest("hex");
    const expectedSha = createHash("sha256").update(text).digest("hex");
    if (fileSha256 !== expectedSha) {
      await unlink(input.destinationPath).catch(() => undefined);
      return { ok: false, code: "BACKUP_READBACK_FAILED", message: "Readback hash mismatch." };
    }
    return { ok: true, fileSha256 };
  } catch (e) {
    await handle?.close().catch(() => undefined);
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, code: "BACKUP_DESTINATION_EXISTS", message: "Destination exists." };
    }
    await unlink(input.destinationPath).catch(() => undefined);
    return { ok: false, code: "BACKUP_PUBLISH_FAILED", message: e instanceof Error ? e.message : "Publish failed." };
  }
}

export async function publishPrivateTextFile(input: {
  destinationPath: string;
  approvedPrivateRoot: string;
  text: string;
}): Promise<{ ok: true; fileSha256: string } | { ok: false; code: string; message: string }> {
  try {
    await assertPrivatePathUnderRoot(input.destinationPath, input.approvedPrivateRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid destination.";
    return { ok: false, code: "BACKUP_DESTINATION_INVALID", message };
  }
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(input.destinationPath, "wx", 0o600);
    await handle.writeFile(input.text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = await readFile(input.destinationPath, "utf8");
    const fileSha256 = createHash("sha256").update(readback).digest("hex");
    const expectedSha = createHash("sha256").update(input.text).digest("hex");
    if (fileSha256 !== expectedSha) {
      await unlink(input.destinationPath).catch(() => undefined);
      return { ok: false, code: "BACKUP_READBACK_FAILED", message: "Readback hash mismatch." };
    }
    return { ok: true, fileSha256 };
  } catch (e) {
    await handle?.close().catch(() => undefined);
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, code: "BACKUP_DESTINATION_EXISTS", message: "Destination exists." };
    }
    await unlink(input.destinationPath).catch(() => undefined);
    return { ok: false, code: "BACKUP_PUBLISH_FAILED", message: e instanceof Error ? e.message : "Publish failed." };
  }
}
