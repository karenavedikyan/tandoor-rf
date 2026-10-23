import type { MatchedOnlyBundlePlanV1 } from "../types";
import { MATCHED_ONLY_POLICY } from "../types";

export const EXECUTION_MANIFEST_V = 2 as const;

export type ExecutionManifestApproval = {
  status: "NOT_APPROVED" | "APPROVED";
  /** Out-of-band operator hash; must match CLI --approved-execution-hash when status is APPROVED. */
  approvedExecutionHash: string | null;
  humanDecisionRef: string | null;
  validUntil: string | null;
};

export type ExecutionManifestBudgetV2 = {
  quantityScale: 6;
  operationScopeDigest: string;
  beforeStateSha256: string;
  counts: MatchedOnlyBundlePlanV1["counts"];
  expectedDmlInserts: {
    saleAggregate: number;
    saleItems: number;
    returnsAggregate: number;
    returnItems: number;
  };
  /** Matched return-item income only (aggregate/items not summed). */
  returnsMatchedIncome: string;
};

export type ExecutionManifestPrivateBackupCapture = {
  status: "NOT_APPROVED" | "APPROVED";
  destinationPath: string | null;
};

export type ExecutionManifestV2 = {
  v: typeof EXECUTION_MANIFEST_V;
  policy: typeof MATCHED_ONLY_POLICY;
  operation: "apply" | "rollback";
  executionId: string;
  contentHash: string;
  approval: ExecutionManifestApproval;
  executionBudget: ExecutionManifestBudgetV2 | null;
  privateBackupCapture: ExecutionManifestPrivateBackupCapture | null;
  target: {
    controlPlane: { timewebAppId: number; timewebDbId: number };
    expectedDbFingerprint: string;
    draftMigration049SqlSha256: string;
  };
  provenance: {
    codeArtifactLabel: string | null;
    observedRuntimeFingerprint: string | null;
  };
  planHash: string | null;
  plan: MatchedOnlyBundlePlanV1 | null;
  sourcePaths: {
    saleAggregate: string;
    saleItems: string;
    returnsAggregate: string;
    returnItems: string;
  };
  backup: {
    filePath: string | null;
    expectedSha256: string | null;
  };
  rollback?: {
    originalApplyPlanHash: string | null;
    expectedLiveAfterStateSha256: string | null;
    rollbackScopeHash: string | null;
  };
};
