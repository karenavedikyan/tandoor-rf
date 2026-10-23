export const MATCHED_ONLY_POLICY = "matched-only" as const;

export type MatchedOnlyDataset =
  | "sale_aggregate"
  | "sale_items"
  | "return_aggregate"
  | "return_items";

export type DatasetRowCounts = {
  full: number;
  matched: number;
  excluded: number;
};

export type MatchedOnlyBundlePlanV1 = {
  v: 1;
  policy: typeof MATCHED_ONLY_POLICY;
  sourceHashes: {
    saleAggregate: string;
    saleItems: string;
    returnsAggregate: string;
    returnItems: string;
  };
  periods: string[];
  parity: {
    salesParityOk: boolean;
    returnsParityOk: boolean;
  };
  identity: {
    targetDbFingerprint: string;
  };
  catalog: {
    fingerprint: string;
    knownLegalEntityCount: number;
    unknownUnionDigest: string;
    unknownUnionCount: number;
  };
  counts: {
    saleAggregate: DatasetRowCounts;
    saleItems: DatasetRowCounts;
    returnsAggregate: DatasetRowCounts;
    returnItems: DatasetRowCounts;
  };
  scope: {
    saleMonthsIso: string[];
    operationsDigest: string;
  };
  beforeStateSha256: string;
};

export type MatchedOnlyScopedBackupV1 = {
  v: 1;
  planHash: string;
  targetDbFingerprint: string;
  beforeStateSha256: string;
  capturedAt: string;
  saleMonthsIso: string[];
  sourceHashes: MatchedOnlyBundlePlanV1["sourceHashes"];
  tables: {
    saleAggregateLines: unknown[];
    saleItemLines: unknown[];
    returnLines: unknown[];
    returnItemLines: unknown[];
    importStates: unknown[];
    monthActivations: unknown[];
    monthStats: unknown[];
    quarantineRows: unknown[];
    applyRuns: unknown[];
  };
};

export type MatchedOnlyMode = "plan" | "validate-backup" | "apply" | "rollback";

export type MatchedOnlyRunResult =
  | {
      ok: true;
      mode: MatchedOnlyMode;
      plan?: MatchedOnlyBundlePlanV1;
      planHash?: string;
      receipt?: MatchedOnlyApplyReceiptV1;
      backup?: MatchedOnlyScopedBackupV1;
    }
  | { ok: false; mode: MatchedOnlyMode; code: string; message: string };

export type MatchedOnlyApplyReceiptV1 = {
  v: 1;
  planHash: string;
  targetDbFingerprint: string;
  beforeStateSha256: string;
  afterStateSha256: string;
  backupSha256: string;
  status: "applied" | "no_op_already_applied" | "commit_uncertain";
  appliedAt: string;
  inserted: DatasetRowCounts & {
    saleAggregate: number;
    saleItems: number;
    returnsAggregate: number;
    returnItems: number;
  };
  quarantined: MatchedOnlyBundlePlanV1["counts"];
};
