import { STABILITY_DELAY_MS } from "./constants";
import type { CatalogFileEntry } from "./types";

function entriesEqual(left: CatalogFileEntry[], right: CatalogFileEntry[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (a.relativePath !== b.relativePath || a.sha256 !== b.sha256 || a.byteSize !== b.byteSize) {
      return false;
    }
    if (!a.bytes.equals(b.bytes)) return false;
  }
  return true;
}

export async function readStableCatalogSet<T extends { ok: true; files: CatalogFileEntry[] } | { ok: false }>(
  readOnce: () => Promise<T>,
  delayMs = STABILITY_DELAY_MS,
): Promise<
  | { ok: true; files: CatalogFileEntry[]; readAt: string }
  | { ok: false; code: "UNSTABLE_SOURCE" | "READ_FAILED"; message: string }
> {
  const first = await readOnce();
  if (!first.ok) {
    return { ok: false, code: "READ_FAILED", message: "Initial catalog read failed." };
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const second = await readOnce();
  if (!second.ok) {
    return { ok: false, code: "READ_FAILED", message: "Stability re-read failed." };
  }
  if (!entriesEqual(first.files, second.files)) {
    return {
      ok: false,
      code: "UNSTABLE_SOURCE",
      message: "Catalog file set changed between stability reads.",
    };
  }
  return { ok: true, files: first.files, readAt: new Date().toISOString() };
}
