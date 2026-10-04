import type { CatalogImportProfile } from "../onec-catalog/constants";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import type { ValidatedClientsPayload } from "../onec-clients/types";
import type { ParsedCatalogSet } from "../onec-catalog/types";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";

export type CleanReloadMode = "dry_run" | "apply";

export type PinnedBundleFile = {
  relativePath: string;
  bytes: Buffer;
  sha256: string;
  byteSize: number;
};

export type PinnedCleanReloadBundle = {
  bundleDir: string;
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  catalogProfile: CatalogImportProfile;
  clients: PinnedBundleFile;
  employees: PinnedBundleFile;
  catalogFiles: PinnedBundleFile[];
  catalogManifestSha256: string;
  bundleFingerprint: string;
  clientsPayload: ValidatedClientsPayload;
  employeeRoster: WholesaleEmployeeRoster;
  catalogData: ParsedCatalogSet | null;
  verificationFingerprint: string;
};

export type CleanReloadPlan = {
  targetDbFingerprint: string;
  bundleFingerprint: string;
  catalogManifestSha256: string;
  clientsRecordCount: number;
  wholesaleEmployeeCount: number;
  catalogProductCount: number;
  purgeScope: {
    tableGroups: string[];
    orphanCleanupStatements: number;
  };
};

export type CleanReloadSuccess = {
  ok: true;
  mode: CleanReloadMode;
  durationMs: number;
  plan: CleanReloadPlan;
  apply?: {
    clientsImportRunId: string;
    catalogImportRunId?: string;
    catalogVersionId?: string;
    imageSyncRunId?: string;
    imageSyncStatus?: string;
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

export type RunCleanReloadOptions = {
  mode: CleanReloadMode;
  bundleDir: string;
  databaseUrl: string;
  holdingLinkPolicy?: HoldingLinkValidationPolicy;
  catalogProfile?: CatalogImportProfile;
  expectedBundleFingerprint?: string;
  confirmTargetDb?: string;
  confirmExtendedContract?: boolean;
  operatorReference?: string;
  operatorNote?: string;
  skipCatalog?: boolean;
  skipImageSync?: boolean;
};
