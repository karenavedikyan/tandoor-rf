import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import type { ValidatedClientsPayload } from "../onec-clients/types";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";

export type CleanReloadMode = "dry_run" | "apply";

export type PinnedBundleFile = {
  relativePath: string;
  bytes: Buffer;
  sha256: string;
  byteSize: number;
};

export type BundleCompositionStats = {
  clientsRecordCount: number;
  retailOutletsOpen: number;
  retailOutletsClosed: number;
  retailOutletsWithoutGuidStore: number;
  wholesaleEmployeeCount: number;
  employeesWithoutClients: number;
  assignmentsOutsideRoster: number;
  clientsWithoutManager: number;
  unresolvedHoldingLinks: number;
};

export type PinnedCleanReloadBundle = {
  bundleDir: string;
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  clients: PinnedBundleFile;
  employees: PinnedBundleFile;
  bundleFingerprint: string;
  clientsPayload: ValidatedClientsPayload;
  employeeRoster: WholesaleEmployeeRoster;
  verificationFingerprint: string;
  stats: BundleCompositionStats;
  expectedOutletGuids: readonly string[];
};

export type CleanReloadPlan = {
  targetDbFingerprint: string;
  targetDb: {
    host: string;
    port: string;
    database: string;
  };
  bundleFingerprint: string;
  stats: BundleCompositionStats;
  schemaDependencies: string[];
  blockers: string[];
  purgeScope: {
    tableGroups: string[];
    orphanCleanupStatements: number;
    catalogUntouched: true;
  };
};

export type CleanReloadSuccess = {
  ok: true;
  mode: CleanReloadMode;
  durationMs: number;
  plan: CleanReloadPlan;
  apply?: {
    clientsImportRunId: string;
    rosterEmployeeCount: number;
    revokedEmployeeLinks: number;
    outletGuidsLoaded: readonly string[];
  };
};

export type CleanReloadFailure = {
  ok: false;
  mode: CleanReloadMode;
  durationMs: number;
  code: string;
  message: string;
  plan?: CleanReloadPlan;
  details?: Record<string, unknown>;
};

export type CleanReloadResult = CleanReloadSuccess | CleanReloadFailure;

export type CleanReloadTestHooks = {
  afterPurge?: (client: import("pg").PoolClient) => Promise<void>;
  afterClientsImport?: (client: import("pg").PoolClient) => Promise<void>;
  beforeRosterReplace?: (client: import("pg").PoolClient) => Promise<void>;
};

export type RunCleanReloadOptions = {
  mode: CleanReloadMode;
  bundleDir: string;
  databaseUrl: string;
  holdingLinkPolicy?: HoldingLinkValidationPolicy;
  expectedBundleFingerprint?: string;
  confirmTargetDb?: string;
  confirmExtendedContract?: boolean;
  operatorReference?: string;
  operatorNote?: string;
  testHooks?: CleanReloadTestHooks;
};
