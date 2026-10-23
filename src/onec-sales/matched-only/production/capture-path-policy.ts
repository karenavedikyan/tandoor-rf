import { lstat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ExecutionManifestV2 } from "./manifest-types";

const PUBLIC_PATH_MARKERS = ["/public/", "/static/", "/runtime-export/"];

export function resolveCaptureApprovedPrivateRoot(manifest: ExecutionManifestV2): string | null {
  const harness = process.env.MATCHED_ONLY_CAPTURE_HARNESS_ROOT?.trim();
  if (harness) {
    return resolve(harness);
  }
  const fromManifest = manifest.privateBackupCapture?.approvedPrivateRoot?.trim();
  return fromManifest ? resolve(fromManifest) : null;
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

  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error("CAPTURE_DESTINATION_SYMLINK_ROOT");
  }
  if (!process.env.MATCHED_ONLY_CAPTURE_HARNESS_ROOT?.trim()) {
    const rootMode = rootStat.mode & 0o777;
    if (rootMode & 0o077) {
      throw new Error("CAPTURE_ROOT_NOT_PRIVATE");
    }
  }

  let current = dirname(dest);
  while (current !== dirname(root) && current.length >= root.length) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error("CAPTURE_DESTINATION_SYMLINK_ANCESTOR");
    }
    if (current === root) {
      break;
    }
    current = dirname(current);
  }
}
