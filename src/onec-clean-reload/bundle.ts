import { createHash } from "node:crypto";
import path from "node:path";
import { parseWholesaleEmployeeRosterBytes } from "../onec-clients/employee-roster";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import { verificationFingerprintFromPayload } from "../onec-clients/import-verification-fingerprint";
import { validateClientsFileBytes } from "../onec-clients/validate";
import type { ValidateClientsLimits } from "../onec-clients/validate";
import { computeBundleCompositionStats } from "./bundle-stats";
import {
  BUNDLE_CLIENTS_FILE,
  BUNDLE_EMPLOYEES_FILE,
  DEFAULT_HOLDING_LINK_POLICY,
} from "./constants";
import { validateCleanReloadOutletIdentityBytes } from "./outlet-validation";
import { readBoundedBundleFile } from "./read-bounded-file";
import { validateCleanReloadRosterSqlFields } from "./roster-validation";
import type { PinnedBundleFile, PinnedCleanReloadBundle } from "./types";

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
  files: Array<{ relativePath: string; sha256: string }>;
}): string {
  const sorted = [...input.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const payload = {
    kind: "onec_rf_client_composition_reload_v1",
    holdingLinkPolicy: input.holdingLinkPolicy,
    files: sorted,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function loadPinnedCleanReloadBundle(input: {
  bundleDir: string;
  holdingLinkPolicy?: HoldingLinkValidationPolicy;
}): Promise<PinnedCleanReloadBundle> {
  const bundleDir = path.resolve(input.bundleDir);
  const holdingLinkPolicy = input.holdingLinkPolicy ?? DEFAULT_HOLDING_LINK_POLICY;

  const clientsBytes = await readBoundedBundleFile(bundleDir, BUNDLE_CLIENTS_FILE);
  const employeesBytes = await readBoundedBundleFile(bundleDir, BUNDLE_EMPLOYEES_FILE);
  const clients = pinFile(BUNDLE_CLIENTS_FILE, clientsBytes);
  const employees = pinFile(BUNDLE_EMPLOYEES_FILE, employeesBytes);

  const outletValidation = validateCleanReloadOutletIdentityBytes(clientsBytes);
  if (!outletValidation.ok) {
    throw Object.assign(new Error("Clean reload requires identified retail outlets (guid_store + closed)."), {
      code: outletValidation.code,
      issues: outletValidation.issues,
    });
  }

  const rosterSqlValidation = validateCleanReloadRosterSqlFields(employeesBytes);
  if (!rosterSqlValidation.ok) {
    throw Object.assign(new Error("Employee roster contains fields that cannot be stored in PostgreSQL."), {
      code: rosterSqlValidation.code,
      issues: rosterSqlValidation.issues,
    });
  }

  const rosterParsed = parseWholesaleEmployeeRosterBytes(employeesBytes);
  if (!rosterParsed.ok) {
    throw Object.assign(new Error(rosterParsed.message), { code: rosterParsed.code });
  }
  if (rosterParsed.roster.isEmpty) {
    throw Object.assign(new Error("Wholesale employee roster is empty; clean reload blocked."), {
      code: "EMPLOYEE_ROSTER_EMPTY",
    });
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

  const bundleFingerprint = computeBundleFingerprint({
    holdingLinkPolicy,
    files: [
      { relativePath: clients.relativePath, sha256: clients.sha256 },
      { relativePath: employees.relativePath, sha256: employees.sha256 },
    ],
  });

  const clientsPayload = clientsValidated.payload;
  const verificationFingerprint = verificationFingerprintFromPayload({ payload: clientsPayload });
  const stats = computeBundleCompositionStats({
    payload: clientsPayload,
    employeeRoster: rosterParsed.roster,
  });

  return {
    bundleDir,
    holdingLinkPolicy,
    clients,
    employees,
    bundleFingerprint,
    clientsPayload,
    employeeRoster: rosterParsed.roster,
    verificationFingerprint,
    stats,
    expectedOutletGuids: outletValidation.outletGuids,
  };
}
