import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CATALOG_IMPORT_PROFILE,
  getCatalogFilesForProfile,
  MAX_CATALOG_FILE_BYTES,
  MAX_CATALOG_SET_BYTES,
  type CatalogImportProfile,
} from "./constants";
import type { CatalogFileEntry, ValidationIssue } from "./types";
import { buildFileEntries } from "./manifest";

export async function readCatalogSetFromLocalDir(
  localDir: string,
  profile: CatalogImportProfile = DEFAULT_CATALOG_IMPORT_PROFILE,
): Promise<{ ok: true; files: CatalogFileEntry[] } | { ok: false; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const fileList = getCatalogFilesForProfile(profile);
  const inputs: Array<{ relativePath: (typeof fileList)[number]; bytes: Buffer }> = [];
  let totalBytes = 0;

  for (const relativePath of fileList) {
    const absolutePath = path.join(localDir, relativePath);
    let bytes: Buffer;
    try {
      bytes = await readFile(absolutePath);
    } catch {
      issues.push({
        code: "MISSING_SOURCE_FILE",
        message: `Required catalog file is missing locally: ${relativePath}.`,
        file: relativePath,
      });
      continue;
    }
    if (bytes.length > MAX_CATALOG_FILE_BYTES) {
      issues.push({
        code: "FILE_TOO_LARGE",
        message: `Catalog file exceeds per-file limit: ${relativePath}.`,
        file: relativePath,
      });
    }
    totalBytes += bytes.length;
    inputs.push({ relativePath, bytes });
  }

  if (totalBytes > MAX_CATALOG_SET_BYTES) {
    issues.push({
      code: "SET_TOO_LARGE",
      message: "Catalog file set exceeds total byte limit.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, files: buildFileEntries(inputs) };
}
