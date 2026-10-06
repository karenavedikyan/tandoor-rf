import { EXPORT_MANIFEST_VERSION } from "../../src/onec-regular-update/export-manifest";

export function buildExportManifestBytes(input: {
  clientsSha256: string;
  rosterSha256: string;
  exportBatchId?: string;
  exportFormedAt?: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      v: EXPORT_MANIFEST_VERSION,
      export_batch_id: input.exportBatchId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      export_formed_at: input.exportFormedAt ?? "2026-10-06T14:30:00",
      files: {
        "all_clients.json": { sha256: input.clientsSha256.toLowerCase() },
        "all_employees.json": { sha256: input.rosterSha256.toLowerCase() },
      },
    }),
    "utf8",
  );
}
