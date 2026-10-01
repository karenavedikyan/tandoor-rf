import { createHash } from "node:crypto";
import { CATALOG_RELATIVE_FILES } from "./constants";
import type { CatalogFileEntry, CatalogManifest } from "./types";

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function buildManifest(files: CatalogFileEntry[]): CatalogManifest {
  const ordered = CATALOG_RELATIVE_FILES.map((relativePath) => {
    const found = files.find((file) => file.relativePath === relativePath);
    if (!found) {
      throw new Error(`Missing manifest file: ${relativePath}`);
    }
    return found;
  });
  const canonical = ordered
    .map((file) => `${file.relativePath}\t${file.byteSize}\t${file.sha256}`)
    .join("\n");
  const manifestSha256 = sha256Hex(Buffer.from(canonical, "utf8"));
  const totalByteSize = ordered.reduce((sum, file) => sum + file.byteSize, 0);
  return { files: ordered, manifestSha256, totalByteSize };
}

export function buildFileEntries(
  inputs: Array<{ relativePath: CatalogFileEntry["relativePath"]; bytes: Buffer }>,
): CatalogFileEntry[] {
  return inputs.map((input) => ({
    relativePath: input.relativePath,
    bytes: input.bytes,
    byteSize: input.bytes.length,
    sha256: sha256Hex(input.bytes),
  }));
}
