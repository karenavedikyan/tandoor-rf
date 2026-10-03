import fs from "node:fs";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { BaselineReplacementMode } from "./baseline-replacement";

export type BaselineReplacementCliOptions = {
  mode: BaselineReplacementMode;
  clientsFile: string;
  employeeRosterFile?: string;
  quarantineManifestFile: string;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  expectedFingerprint?: string;
  confirmExtendedContract: boolean;
  operatorReference?: string;
  operatorNote?: string;
  rollbackRunId?: string;
};

export type BaselineReplacementCliParseFailure = {
  ok: false;
  code:
    | "MISSING_CLIENTS_FILE"
    | "MISSING_QUARANTINE_MANIFEST"
    | "CONFLICTING_MODES"
    | "MISSING_EXPECTED_FINGERPRINT"
    | "MISSING_OPERATOR_REFERENCE"
    | "FILE_READ_ERROR"
    | "INVALID_HOLDING_POLICY";
  message: string;
};

export type BaselineReplacementCliParseSuccess = {
  ok: true;
  options: BaselineReplacementCliOptions;
};

export function readBaselineFileBytes(path: string): Buffer | BaselineReplacementCliParseFailure {
  try {
    return fs.readFileSync(path);
  } catch {
    return { ok: false, code: "FILE_READ_ERROR", message: `Cannot read file: ${path}` };
  }
}

export function parseBaselineReplacementCliArgs(
  argv: string[],
): BaselineReplacementCliParseFailure | BaselineReplacementCliParseSuccess {
  let mode: BaselineReplacementMode | undefined;
  let clientsFile: string | undefined;
  let employeeRosterFile: string | undefined;
  let quarantineManifestFile: string | undefined;
  let holdingLinkValidationPolicy: HoldingLinkValidationPolicy = "tolerant";
  let expectedFingerprint: string | undefined;
  let confirmExtendedContract = false;
  let operatorReference: string | undefined;
  let operatorNote: string | undefined;
  let rollbackRunId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      mode = "dry_run";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg === "--rollback") {
      mode = "rollback";
      continue;
    }
    if (arg === "--confirm-extended-contract") {
      confirmExtendedContract = true;
      continue;
    }
    if (arg.startsWith("--clients-file=")) {
      clientsFile = arg.slice("--clients-file=".length);
      continue;
    }
    if (arg === "--clients-file") {
      clientsFile = argv[++index];
      continue;
    }
    if (arg.startsWith("--employee-roster=")) {
      employeeRosterFile = arg.slice("--employee-roster=".length);
      continue;
    }
    if (arg === "--employee-roster") {
      employeeRosterFile = argv[++index];
      continue;
    }
    if (arg.startsWith("--quarantine-manifest=")) {
      quarantineManifestFile = arg.slice("--quarantine-manifest=".length);
      continue;
    }
    if (arg === "--quarantine-manifest") {
      quarantineManifestFile = argv[++index];
      continue;
    }
    if (arg.startsWith("--holding-link-policy=")) {
      const value = arg.slice("--holding-link-policy=".length);
      if (value !== "tolerant" && value !== "strict") {
        return { ok: false, code: "INVALID_HOLDING_POLICY", message: "holding-link-policy must be tolerant or strict." };
      }
      holdingLinkValidationPolicy = value;
      continue;
    }
    if (arg.startsWith("--expected-fingerprint=")) {
      expectedFingerprint = arg.slice("--expected-fingerprint=".length);
      continue;
    }
    if (arg === "--expected-fingerprint") {
      expectedFingerprint = argv[++index];
      continue;
    }
    if (arg.startsWith("--operator-reference=")) {
      operatorReference = arg.slice("--operator-reference=".length);
      continue;
    }
    if (arg === "--operator-reference") {
      operatorReference = argv[++index];
      continue;
    }
    if (arg.startsWith("--operator-note=")) {
      operatorNote = arg.slice("--operator-note=".length);
      continue;
    }
    if (arg.startsWith("--rollback-run-id=")) {
      rollbackRunId = arg.slice("--rollback-run-id=".length);
      continue;
    }
  }

  if (!mode) {
    mode = "dry_run";
  }

  if (mode === "rollback") {
    return {
      ok: true,
      options: {
        mode,
        clientsFile: clientsFile ?? "",
        quarantineManifestFile: quarantineManifestFile ?? "",
        holdingLinkValidationPolicy,
        rollbackRunId,
        confirmExtendedContract: false,
        operatorNote,
      },
    };
  }

  if (!clientsFile) {
    return { ok: false, code: "MISSING_CLIENTS_FILE", message: "--clients-file is required." };
  }
  if (!quarantineManifestFile) {
    return {
      ok: false,
      code: "MISSING_QUARANTINE_MANIFEST",
      message: "--quarantine-manifest is required.",
    };
  }
  if (mode === "apply" && !expectedFingerprint?.trim()) {
    return {
      ok: false,
      code: "MISSING_EXPECTED_FINGERPRINT",
      message: "--apply requires --expected-fingerprint from dry-run.",
    };
  }
  if (mode === "apply" && confirmExtendedContract && !operatorReference?.trim()) {
    return {
      ok: false,
      code: "MISSING_OPERATOR_REFERENCE",
      message: "--confirm-extended-contract requires --operator-reference.",
    };
  }

  return {
    ok: true,
    options: {
      mode,
      clientsFile,
      employeeRosterFile,
      quarantineManifestFile,
      holdingLinkValidationPolicy,
      expectedFingerprint,
      confirmExtendedContract,
      operatorReference,
      operatorNote,
      rollbackRunId,
    },
  };
}
