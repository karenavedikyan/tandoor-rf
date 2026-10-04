import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getCatalogFilesForProfile,
  type CatalogImportProfile,
} from "../onec-catalog/constants";
import { DEFAULT_CATALOG_PROFILE } from "./constants";
import { buildManifest } from "../onec-catalog/manifest";
import { parseCatalogSet } from "../onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../onec-catalog/validate-catalog-set";
import type { CatalogFileEntry, ParsedCatalogSet } from "../onec-catalog/types";
import { BUNDLE_CLIENTS_FILE, BUNDLE_EMPLOYEES_FILE, DEFAULT_HOLDING_LINK_POLICY } from "./constants";
import type { PinnedBundleFile, PinnedCleanReloadBundle } from "./types";
import { parseWholesaleEmployeeRosterBytes } from "../onec-clients/employee-roster";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import { verificationFingerprintFromPayload } from "../onec-clients/import-verification-fingerprint";
import { validateClientsFileBytes } from "../onec-clients/validate";
import type { ValidateClientsLimits } from "../onec-clients/validate";

function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pinFile(relativePath: string, bytes: Buffer): PinnedBundleFile {
  return {
    relativePath,
    bytes,
    sha256: sha256Buffer(bytes),
    byteSize: bytes.length,
  };
}

export function computeBundleFingerprint(input: {
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  catalogProfile: CatalogImportProfile;
  files: Array<{ relativePath: string; sha256: string }>;
}): string {
  const sorted = [...input.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const payload = {
    kind: "onec_rf_clean_reload_bundle_v1",
    holdingLinkPolicy: input.holdingLinkPolicy,
    catalogProfile: input.catalogProfile,
    files: sorted,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function readRequiredFile(bundleDir: string, relativePath: string): Promise<Buffer> {
  try {
    return await readFile(path.join(bundleDir, relativePath));
  } catch {
    throw Object.assign(new Error(`Required bundle file is missing or unreadable: ${relativePath}.`), {
      code: "BUNDLE_FILE_MISSING",
    });
  }
}

export async function loadPinnedCleanReloadBundle(input: {
  bundleDir: string;
  holdingLinkPolicy?: HoldingLinkValidationPolicy;
  catalogProfile?: CatalogImportProfile;
  skipCatalog?: boolean;
}): Promise<PinnedCleanReloadBundle> {
  const bundleDir = path.resolve(input.bundleDir);
  const holdingLinkPolicy = input.holdingLinkPolicy ?? DEFAULT_HOLDING_LINK_POLICY;
  const catalogProfile = input.catalogProfile ?? DEFAULT_CATALOG_PROFILE;

  const clientsBytes = await readRequiredFile(bundleDir, BUNDLE_CLIENTS_FILE);
  const employeesBytes = await readRequiredFile(bundleDir, BUNDLE_EMPLOYEES_FILE);
  const clients = pinFile(BUNDLE_CLIENTS_FILE, clientsBytes);
  const employees = pinFile(BUNDLE_EMPLOYEES_FILE, employeesBytes);

  const rosterParsed = parseWholesaleEmployeeRosterBytes(employeesBytes);
  if (!rosterParsed.ok) {
    throw Object.assign(new Error(rosterParsed.message), { code: rosterParsed.code });
  }

  const validationLimits: ValidateClientsLimits = {
    holdingLinkValidationPolicy: holdingLinkPolicy,
    employeeRoster: rosterParsed.roster,
    employeeRosterExplicit: true,
    wholesaleCompositionMode: "standard",
  };
  const clientsValidated = validateClientsFileBytes(clientsBytes, validationLimits);
  if (!clientsValidated.ok) {
    throw Object.assign(new Error("Client bundle validation failed."), {
      code: "CLIENTS_VALIDATION_FAILED",
      issues: clientsValidated.issues,
    });
  }

  const catalogFiles: PinnedBundleFile[] = [];
  let catalogManifestSha256 = "";
  let catalogData: ParsedCatalogSet | null = null;

  if (!input.skipCatalog) {
    const catalogEntries: CatalogFileEntry[] = [];
    for (const relativePath of getCatalogFilesForProfile(catalogProfile)) {
      const bytes = await readRequiredFile(bundleDir, relativePath);
      const pinned = pinFile(relativePath, bytes);
      catalogFiles.push(pinned);
      catalogEntries.push({
        relativePath,
        bytes,
        sha256: pinned.sha256,
        byteSize: pinned.byteSize,
      });
    }
    const manifest = buildManifest(catalogEntries, catalogProfile);
    catalogManifestSha256 = manifest.manifestSha256;
    const parsed = await parseCatalogSet(catalogEntries);
    if (!parsed.ok) {
      throw Object.assign(new Error("Catalog bundle parse failed."), {
        code: "CATALOG_PARSE_FAILED",
        issues: parsed.issues,
      });
    }
    const validated = validateCatalogSet(parsed.data);
    if (!validated.ok) {
      throw Object.assign(new Error("Catalog bundle validation failed."), {
        code: "CATALOG_VALIDATION_FAILED",
        issues: validated.issues,
      });
    }
    catalogData = validated.data;
  }

  const fingerprintFiles = [
    { relativePath: clients.relativePath, sha256: clients.sha256 },
    { relativePath: employees.relativePath, sha256: employees.sha256 },
    ...catalogFiles.map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 })),
  ];
  const bundleFingerprint = computeBundleFingerprint({
    holdingLinkPolicy,
    catalogProfile,
    files: fingerprintFiles,
  });

  const clientsPayload = clientsValidated.payload;
  const verificationFingerprint = verificationFingerprintFromPayload({ payload: clientsPayload });

  return {
    bundleDir,
    holdingLinkPolicy,
    catalogProfile,
    clients,
    employees,
    catalogFiles,
    catalogManifestSha256,
    bundleFingerprint,
    clientsPayload,
    employeeRoster: rosterParsed.roster,
    catalogData,
    verificationFingerprint,
  };
}
