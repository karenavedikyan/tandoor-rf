import { createHash } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

async function assertPrivateRoot(destinationPath: string, approvedRoot: string): Promise<void> {
  const root = resolve(approvedRoot);
  const dest = resolve(destinationPath);
  if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
    throw new Error("CAPTURE_DESTINATION_OUTSIDE_ROOT");
  }
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) {
    throw new Error("CAPTURE_DESTINATION_SYMLINK_ROOT");
  }
  const mode = stat.mode & 0o777;
  if (mode & 0o077) {
    throw new Error("CAPTURE_ROOT_NOT_PRIVATE");
  }
}

export async function publishPrivateBackupJson(input: {
  destinationPath: string;
  approvedPrivateRoot: string;
  payload: unknown;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await assertPrivateRoot(input.destinationPath, input.approvedPrivateRoot);
  } catch (e) {
    return {
      ok: false,
      code: "BACKUP_DESTINATION_INVALID",
      message: e instanceof Error ? e.message : "Invalid destination.",
    };
  }
  const text = `${JSON.stringify(input.payload, null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(input.destinationPath, "wx", 0o600);
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = await readFile(input.destinationPath, "utf8");
    const a = createHash("sha256").update(readback).digest("hex");
    const b = createHash("sha256").update(text).digest("hex");
    if (a !== b) {
      await unlink(input.destinationPath).catch(() => undefined);
      return { ok: false, code: "BACKUP_READBACK_FAILED", message: "Readback hash mismatch." };
    }
    return { ok: true };
  } catch (e) {
    await handle?.close().catch(() => undefined);
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, code: "BACKUP_DESTINATION_EXISTS", message: "Destination exists." };
    }
    await unlink(input.destinationPath).catch(() => undefined);
    return { ok: false, code: "BACKUP_PUBLISH_FAILED", message: e instanceof Error ? e.message : "Publish failed." };
  }
}
