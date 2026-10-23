import { planHashFromPlan } from "../plan-build";
import type { ExecutionManifestV2 } from "./manifest-types";
import { computeExecutionManifestContentHash } from "./manifest-hash";
import {
  DRAFT_MIGRATION_049_SQL_SHA256,
  EXPECTED_PRODUCTION_DB_FINGERPRINT,
  TIMEWEB_MATCHED_ONLY_APP_ID,
  TIMEWEB_MATCHED_ONLY_DB_ID,
} from "./target-policy";

export type ManifestValidationFailureCode =
  | "MANIFEST_INVALID"
  | "MANIFEST_CONTENT_HASH_MISMATCH"
  | "MANIFEST_NOT_APPROVED"
  | "MANIFEST_APPROVAL_EXPIRED"
  | "MANIFEST_APPROVAL_HASH_MISSING"
  | "MANIFEST_APPROVED_HASH_MISMATCH"
  | "MANIFEST_PLAN_MISSING"
  | "MANIFEST_PLAN_HASH_MISMATCH"
  | "MANIFEST_TARGET_POLICY_MISMATCH"
  | "MANIFEST_OPERATION_MISMATCH";

export type ManifestValidationResult =
  | { ok: true; manifest: ExecutionManifestV2 }
  | { ok: false; code: ManifestValidationFailureCode; message: string };

export function validateExecutionManifestForRun(input: {
  manifest: ExecutionManifestV2;
  operation: "apply" | "rollback";
  approvedExecutionHash?: string;
  requireApproved: boolean;
  allowMissingPlan?: boolean;
}): ManifestValidationResult {
  const { manifest, operation, approvedExecutionHash, requireApproved, allowMissingPlan } = input;
  if (manifest.v !== 2 || manifest.policy !== "matched-only") {
    return { ok: false, code: "MANIFEST_INVALID", message: "Unsupported manifest version or policy." };
  }
  if (manifest.operation !== operation) {
    return {
      ok: false,
      code: "MANIFEST_OPERATION_MISMATCH",
      message: "Manifest operation does not match CLI mode.",
    };
  }
  const computed = computeExecutionManifestContentHash(manifest);
  if (computed !== manifest.contentHash) {
    return {
      ok: false,
      code: "MANIFEST_CONTENT_HASH_MISMATCH",
      message: "Manifest contentHash does not match canonical body.",
    };
  }
  if (manifest.target.expectedDbFingerprint !== EXPECTED_PRODUCTION_DB_FINGERPRINT) {
    return {
      ok: false,
      code: "MANIFEST_TARGET_POLICY_MISMATCH",
      message: "Manifest target fingerprint does not match pinned production policy.",
    };
  }
  if (manifest.target.draftMigration049SqlSha256 !== DRAFT_MIGRATION_049_SQL_SHA256) {
    return {
      ok: false,
      code: "MANIFEST_TARGET_POLICY_MISMATCH",
      message: "Manifest migration 049 evidence SHA does not match draft release.",
    };
  }
  if (
    manifest.target.controlPlane.timewebAppId !== TIMEWEB_MATCHED_ONLY_APP_ID ||
    manifest.target.controlPlane.timewebDbId !== TIMEWEB_MATCHED_ONLY_DB_ID
  ) {
    return {
      ok: false,
      code: "MANIFEST_TARGET_POLICY_MISMATCH",
      message: "Manifest control-plane identifiers do not match pinned policy.",
    };
  }
  if (requireApproved) {
    if (manifest.approval.status !== "APPROVED") {
      return { ok: false, code: "MANIFEST_NOT_APPROVED", message: "Manifest is not approved for write." };
    }
    if (!manifest.approval.approvedExecutionHash) {
      return {
        ok: false,
        code: "MANIFEST_APPROVAL_HASH_MISSING",
        message: "Approved execution hash missing from manifest.",
      };
    }
    if (!approvedExecutionHash) {
      return {
        ok: false,
        code: "MANIFEST_APPROVED_HASH_MISMATCH",
        message: "CLI --approved-execution-hash is required for write.",
      };
    }
    if (approvedExecutionHash.toLowerCase() !== manifest.approval.approvedExecutionHash.toLowerCase()) {
      return {
        ok: false,
        code: "MANIFEST_APPROVED_HASH_MISMATCH",
        message: "CLI approved execution hash does not match manifest approval.",
      };
    }
    if (manifest.approval.validUntil) {
      const expires = Date.parse(manifest.approval.validUntil);
      if (!Number.isNaN(expires) && Date.now() > expires) {
        return { ok: false, code: "MANIFEST_APPROVAL_EXPIRED", message: "Manifest approval expired." };
      }
    }
  }
  if (!allowMissingPlan) {
    if (!manifest.plan || !manifest.planHash) {
      return { ok: false, code: "MANIFEST_PLAN_MISSING", message: "Manifest plan is required." };
    }
    if (planHashFromPlan(manifest.plan) !== manifest.planHash) {
      return {
        ok: false,
        code: "MANIFEST_PLAN_HASH_MISMATCH",
        message: "Embedded plan hash mismatch.",
      };
    }
  }
  return { ok: true, manifest };
}
