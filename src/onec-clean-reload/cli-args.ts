import { resolve } from "node:path";
import { isHoldingLinkValidationPolicy, type HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import { isSha256Hex } from "../onec-clients/sha256";
import { DEFAULT_HOLDING_LINK_POLICY } from "./constants";
import type { CleanReloadMode } from "./types";

export type CleanReloadCliOptions = {
  mode: CleanReloadMode;
  bundleDir: string;
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  expectedBundleFingerprint?: string;
  confirmTargetDb?: string;
  confirmExtendedContract: boolean;
  operatorReference?: string;
  operatorNote?: string;
};

export type CleanReloadCliParseFailure = {
  ok: false;
  code: string;
  message: string;
};

export type CleanReloadCliParseSuccess = {
  ok: true;
  options: CleanReloadCliOptions;
};

export function parseCleanReloadCliArgs(argv: string[]): CleanReloadCliParseFailure | CleanReloadCliParseSuccess {
  let mode: CleanReloadMode = "dry_run";
  let bundleDir: string | undefined;
  let holdingLinkPolicy: HoldingLinkValidationPolicy = DEFAULT_HOLDING_LINK_POLICY;
  let expectedBundleFingerprint: string | undefined;
  let confirmTargetDb: string | undefined;
  let confirmExtendedContract = false;
  let operatorReference: string | undefined;
  let operatorNote: string | undefined;

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
    if (arg === "--bundle-dir") {
      bundleDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle-dir=")) {
      bundleDir = arg.slice("--bundle-dir=".length);
      continue;
    }
    if (arg === "--holding-link-policy") {
      const value = argv[index + 1];
      index += 1;
      if (!value || !isHoldingLinkValidationPolicy(value)) {
        return { ok: false, code: "INVALID_HOLDING_LINK_POLICY", message: "--holding-link-policy must be tolerant or strict." };
      }
      holdingLinkPolicy = value;
      continue;
    }
    if (arg.startsWith("--holding-link-policy=")) {
      const value = arg.slice("--holding-link-policy=".length);
      if (!isHoldingLinkValidationPolicy(value)) {
        return { ok: false, code: "INVALID_HOLDING_LINK_POLICY", message: "--holding-link-policy must be tolerant or strict." };
      }
      holdingLinkPolicy = value;
      continue;
    }
    if (arg === "--expected-bundle-fingerprint") {
      expectedBundleFingerprint = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--expected-bundle-fingerprint=")) {
      expectedBundleFingerprint = arg.slice("--expected-bundle-fingerprint=".length);
      continue;
    }
    if (arg === "--confirm-target-db") {
      confirmTargetDb = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm-target-db=")) {
      confirmTargetDb = arg.slice("--confirm-target-db=".length);
      continue;
    }
    if (arg === "--confirm-extended-contract") {
      confirmExtendedContract = true;
      continue;
    }
    if (arg === "--operator-reference") {
      operatorReference = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--operator-reference=")) {
      operatorReference = arg.slice("--operator-reference=".length);
      continue;
    }
    if (arg === "--operator-note") {
      operatorNote = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { ok: false, code: "HELP", message: "help" };
    }
    return { ok: false, code: "UNKNOWN_ARGUMENT", message: `Unknown argument: ${arg}` };
  }

  if (!bundleDir?.trim()) {
    return { ok: false, code: "BUNDLE_DIR_REQUIRED", message: "--bundle-dir is required." };
  }

  if (mode === "apply") {
    if (!expectedBundleFingerprint || !isSha256Hex(expectedBundleFingerprint)) {
      return {
        ok: false,
        code: "EXPECTED_BUNDLE_FINGERPRINT_REQUIRED",
        message: "Apply requires --expected-bundle-fingerprint (64-char hex from dry-run).",
      };
    }
    if (!confirmTargetDb || !isSha256Hex(confirmTargetDb)) {
      return {
        ok: false,
        code: "CONFIRM_TARGET_DB_REQUIRED",
        message: "Apply requires --confirm-target-db (64-char hex from dry-run).",
      };
    }
    if (confirmExtendedContract && !operatorReference?.trim()) {
      return {
        ok: false,
        code: "OPERATOR_REFERENCE_REQUIRED",
        message: "--confirm-extended-contract requires --operator-reference.",
      };
    }
  }

  return {
    ok: true,
    options: {
      mode,
      bundleDir: resolve(bundleDir.trim()),
      holdingLinkPolicy,
      expectedBundleFingerprint,
      confirmTargetDb,
      confirmExtendedContract,
      operatorReference,
      operatorNote,
    },
  };
}
