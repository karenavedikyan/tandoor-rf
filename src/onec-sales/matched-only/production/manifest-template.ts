import {
  DRAFT_MIGRATION_049_SQL_SHA256,
  EXPECTED_PRODUCTION_DB_FINGERPRINT,
  TIMEWEB_MATCHED_ONLY_APP_ID,
  TIMEWEB_MATCHED_ONLY_DB_ID,
} from "./target-policy";
import type { ExecutionManifestV2 } from "./manifest-types";
import { withComputedContentHash } from "./manifest-hash";

export function buildNotApprovedExecutionManifestTemplate(
  operation: "apply" | "rollback",
): ExecutionManifestV2 {
  const base: ExecutionManifestV2 = {
    v: 2,
    policy: "matched-only",
    operation,
    executionId: "NOT_APPROVED_TEMPLATE",
    contentHash: "",
    approval: {
      status: "NOT_APPROVED",
      approvedExecutionHash: null,
      humanDecisionRef: null,
      validUntil: null,
    },
    target: {
      controlPlane: {
        timewebAppId: TIMEWEB_MATCHED_ONLY_APP_ID,
        timewebDbId: TIMEWEB_MATCHED_ONLY_DB_ID,
      },
      expectedDbFingerprint: EXPECTED_PRODUCTION_DB_FINGERPRINT,
      draftMigration049SqlSha256: DRAFT_MIGRATION_049_SQL_SHA256,
    },
    provenance: {
      codeArtifactLabel: null,
      observedRuntimeFingerprint: null,
    },
    planHash: null,
    plan: null,
    sourcePaths: {
      saleAggregate: "/LC/sale/sale.json",
      saleItems: "/LC/sale/sale(items).json",
      returnsAggregate: "/LC/sale/returne.json",
      returnItems: "/LC/sale/returne(items).json",
    },
    backup: {
      filePath: null,
      expectedSha256: null,
    },
    ...(operation === "rollback"
      ? {
          rollback: {
            originalApplyPlanHash: null,
            expectedLiveAfterStateSha256: null,
            rollbackScopeHash: null,
          },
        }
      : {}),
  };
  return withComputedContentHash(base);
}
