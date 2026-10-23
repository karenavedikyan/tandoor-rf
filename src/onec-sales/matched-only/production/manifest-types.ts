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

export type DatasetFinancialTotalsV2 = {
  income: string;
  quantity: string;
};

export type SaleItemsFinancialTotalsV2 = DatasetFinancialTotalsV2 & {
  costPrice: string;
};

export type DatasetMatchedTotalsV2 = {
  matchedIncome: string;
  matchedQuantity: string;
};

export type SaleItemsMatchedTotalsV2 = DatasetMatchedTotalsV2 & {
  matchedCostPrice: string;
};

export type DatasetFinancialRollupV2 = {
  full: DatasetFinancialTotalsV2;
  matched: DatasetFinancialTotalsV2;
  excluded: DatasetFinancialTotalsV2;
};

export type SaleItemsFinancialRollupV2 = {
  full: SaleItemsFinancialTotalsV2;
  matched: SaleItemsFinancialTotalsV2;
  excluded: SaleItemsFinancialTotalsV2;
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
  financialTotals: {
    saleAggregate: DatasetFinancialRollupV2;
    saleItems: SaleItemsFinancialRollupV2;
    returnsAggregate: DatasetFinancialRollupV2;
    returnItems: DatasetFinancialRollupV2;
  };
  matchedTotals: {
    saleAggregate: DatasetMatchedTotalsV2;
    saleItems: SaleItemsMatchedTotalsV2;
    returnsAggregate: DatasetMatchedTotalsV2;
    returnItems: DatasetMatchedTotalsV2;
  };
};

export type ExecutionManifestPrivateBackupCapture = {
  status: "NOT_APPROVED" | "APPROVED";
  approvedPrivateRoot: string | null;
  destinationPath: string | null;
  approvedCaptureHash: string | null;
  humanCaptureRef: string | null;
  validUntil: string | null;
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
    expectedExecutableArtifactSha256: string | null;
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
