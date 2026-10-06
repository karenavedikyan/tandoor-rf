import type { OnecFtpConfig } from "../onec-ftp/types";
import { readRemoteFileFromFtp } from "../onec-clients/ftp-read";
import { isSha256Hex } from "../onec-clients/sha256";
import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";
import { FTP_READ_DEADLINE_MS } from "../onec-clients/constants";

export const EXPORT_MANIFEST_RELATIVE_PATH = "clients/export_bundle_manifest.json";
export const EXPORT_MANIFEST_VERSION = 1;

export type ExportBundleManifest = {
  exportBatchId: string;
  exportFormedAt: string | null;
  clientsSha256: string;
  employeeRosterSha256: string;
};

export type ExportManifestFailureCode =
  | "MANIFEST_NOT_FOUND"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID_JSON"
  | "MANIFEST_INVALID_SCHEMA"
  | "MANIFEST_HASH_MISMATCH";

export type ExportManifestVerificationResult =
  | { ok: true; manifest: ExportBundleManifest }
  | { ok: false; code: ExportManifestFailureCode; message: string };

export type ExportManifestReader = (
  config: OnecFtpConfig,
  context?: { readDeadlineMs?: number },
) => Promise<
  | { ok: true; bytes: Buffer }
  | { ok: false; code: "MANIFEST_NOT_FOUND" | "MANIFEST_UNREADABLE"; message: string }
>;

function buildManifestRemotePath(basePath: string): string {
  return `${basePath.replace(/\/+$/, "")}/${EXPORT_MANIFEST_RELATIVE_PATH}`;
}

export const defaultExportManifestReader: ExportManifestReader = async (config, context) => {
  const result = await readRemoteFileFromFtp(
    config,
    buildManifestRemotePath(config.basePath),
    256 * 1024,
    context?.readDeadlineMs ?? FTP_READ_DEADLINE_MS,
  );
  if (!result.ok) {
    return {
      ok: false,
      code: "MANIFEST_UNREADABLE",
      message: "Export bundle manifest is unreadable from FTP.",
    };
  }
  return { ok: true, bytes: result.bytes };
};

function readManifestFileHashes(raw: Record<string, unknown>): { clientsSha256?: string; rosterSha256?: string } {
  const files = raw.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return {};
  }
  const fileMap = files as Record<string, unknown>;
  const clientsEntry = fileMap["all_clients.json"];
  const rosterEntry = fileMap["all_employees.json"];
  const readSha = (entry: unknown): string | undefined => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const sha = (entry as Record<string, unknown>).sha256;
    return typeof sha === "string" ? sha.trim().toLowerCase() : undefined;
  };
  return {
    clientsSha256: readSha(clientsEntry),
    rosterSha256: readSha(rosterEntry),
  };
}

export function verifyExportBundleManifestBytes(
  bytes: Buffer,
  expected: { clientsSha256: string; employeeRosterSha256: string },
): ExportManifestVerificationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      ok: false,
      code: "MANIFEST_INVALID_JSON",
      message: "Export bundle manifest is not valid JSON.",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID_SCHEMA",
      message: "Export bundle manifest root must be a JSON object.",
    };
  }

  const raw = parsed as Record<string, unknown>;
  if (raw.v !== EXPORT_MANIFEST_VERSION) {
    return {
      ok: false,
      code: "MANIFEST_INVALID_SCHEMA",
      message: `Export bundle manifest version must be ${EXPORT_MANIFEST_VERSION}.`,
    };
  }

  const batchId = typeof raw.export_batch_id === "string" ? raw.export_batch_id.trim() : "";
  if (!batchId || !isValidNonZeroUuid(batchId)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID_SCHEMA",
      message: "Export bundle manifest requires export_batch_id as a non-zero UUID.",
    };
  }

  const { clientsSha256, rosterSha256 } = readManifestFileHashes(raw);
  if (!clientsSha256 || !isSha256Hex(clientsSha256)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID_SCHEMA",
      message: "Export bundle manifest must include files.all_clients.json.sha256.",
    };
  }
  if (!rosterSha256 || !isSha256Hex(rosterSha256)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID_SCHEMA",
      message: "Export bundle manifest must include files.all_employees.json.sha256.",
    };
  }

  const expectedClients = expected.clientsSha256.trim().toLowerCase();
  const expectedRoster = expected.employeeRosterSha256.trim().toLowerCase();
  if (clientsSha256 !== expectedClients || rosterSha256 !== expectedRoster) {
    return {
      ok: false,
      code: "MANIFEST_HASH_MISMATCH",
      message:
        "Export bundle manifest file hashes do not match the verified clients and employee roster files.",
    };
  }

  const exportFormedAt =
    typeof raw.export_formed_at === "string" && raw.export_formed_at.trim().length > 0
      ? raw.export_formed_at.trim()
      : null;

  return {
    ok: true,
    manifest: {
      exportBatchId: normalizeUuid(batchId),
      exportFormedAt,
      clientsSha256,
      employeeRosterSha256: rosterSha256,
    },
  };
}

export async function loadVerifiedExportManifest(
  config: OnecFtpConfig,
  expected: { clientsSha256: string; employeeRosterSha256: string },
  options: {
    reader?: ExportManifestReader;
    manifestBytes?: Buffer;
    readDeadlineMs?: number;
  } = {},
): Promise<ExportManifestVerificationResult> {
  if (options.manifestBytes) {
    return verifyExportBundleManifestBytes(options.manifestBytes, expected);
  }

  const reader = options.reader ?? defaultExportManifestReader;
  const read = await reader(config, { readDeadlineMs: options.readDeadlineMs });
  if (!read.ok) {
    return read;
  }
  return verifyExportBundleManifestBytes(read.bytes, expected);
}
