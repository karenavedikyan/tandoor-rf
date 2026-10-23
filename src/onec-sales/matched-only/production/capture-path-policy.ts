import { lstat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ExecutionManifestV2 } from "./manifest-types";

const PUBLIC_PATH_MARKERS = ["/public/", "/static/", "/runtime-export/"];

export function resolveCaptureApprovedPrivateRoot(manifest: ExecutionManifestV2): string | null {
  const fromManifest = manifest.privateBackupCapture?.approvedPrivateRoot?.trim();
  return fromManifest ? resolve(fromManifest) : null;
}

async function assertNoSymlinkAncestors(resolvedPath: string): Promise<void> {
  let current = resolve(resolvedPath);
  while (true) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error("CAPTURE_DESTINATION_SYMLINK_ANCESTOR");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw error;
      }
      throw error;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

export async function assertCaptureDestinationAllowed(
  destinationPath: string,
  approvedRoot: string,
): Promise<void> {
  const root = resolve(approvedRoot);
  const dest = resolve(destinationPath);
  const lower = dest.toLowerCase();
  for (const marker of PUBLIC_PATH_MARKERS) {
    if (lower.includes(marker)) {
      throw new Error("CAPTURE_DESTINATION_PUBLIC_PATH");
    }
  }
  if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
    throw new Error("CAPTURE_DESTINATION_OUTSIDE_ROOT");
  }

  await assertNoSymlinkAncestors(root);
  let symlinkWalkTarget = dest;
  try {
    await lstat(dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    symlinkWalkTarget = dirname(dest);
  }
  await assertNoSymlinkAncestors(symlinkWalkTarget);

  const rootStat = await lstat(root);
  const rootMode = rootStat.mode & 0o777;
  if (rootMode & 0o077) {
    throw new Error("CAPTURE_ROOT_NOT_PRIVATE");
  }
}
