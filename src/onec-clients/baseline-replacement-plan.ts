import type {
  ExcludedArchiveDependencySample,
  MigrationReadiness,
} from "./baseline-replacement-preflight";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { QuarantineDependencySample } from "./quarantine-validation";

export type BaselineReplacementOperationBucket = {
  count: number;
  sampleGuids: string[];
  truncated: boolean;
};

const MAX_SAMPLES = 25;

function bucket(guids: string[]): BaselineReplacementOperationBucket {
  return {
    count: guids.length,
    sampleGuids: guids.slice(0, MAX_SAMPLES),
    truncated: guids.length > MAX_SAMPLES,
  };
}

export type BaselineReplacementPlan = {
  mode: "dry_run" | "apply";
  clientsSourceSha256: string;
  rosterSourceSha256: string | null;
  quarantineManifestSha256: string | null;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  acceptedRecordCount: number;
  quarantinedRecordCount: number;
  incomingRecordCount: number;
  existingActiveCount: number;
  fingerprint: string;
  operations: {
    add: BaselineReplacementOperationBucket;
    update: BaselineReplacementOperationBucket;
    retain: BaselineReplacementOperationBucket;
    archive: BaselineReplacementOperationBucket;
    quarantine: BaselineReplacementOperationBucket;
  };
  dependencyReport: QuarantineDependencySample[];
  acceptedProjection: {
    validationOk: true;
    recordCount: number;
    nestedOutletCount: number | null;
    sourceSha256: string;
  };
  migrationReadiness: MigrationReadiness;
  excludedArchiveDependencies: {
    availability: "loaded" | "partial" | "unavailable";
    unavailableDimensions: string[];
    count: number | null;
    samples: ExcludedArchiveDependencySample[];
    truncated: boolean;
    anyUnknownDependency: boolean;
  };
  extendedContract: {
    status: "unverified" | "operator_confirmed";
    confirmationRequired: boolean;
    confirmationSha256: string | null;
  };
  applyAllowed: boolean;
  blockers: string[];
};

export function buildBaselineReplacementPlan(input: {
  mode: "dry_run" | "apply";
  clientsSourceSha256: string;
  rosterSourceSha256: string | null;
  quarantineManifestSha256: string | null;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  acceptedGuids: Set<string>;
  quarantinedGuids: Set<string>;
  incomingGuids: Set<string>;
  existingActiveGuids: Set<string>;
  existingAllGuids: Set<string>;
  fingerprint: string;
  dependencyReport: QuarantineDependencySample[];
  acceptedProjection: BaselineReplacementPlan["acceptedProjection"];
  migrationReadiness: MigrationReadiness;
  excludedArchiveDependencies: BaselineReplacementPlan["excludedArchiveDependencies"];
  extendedContractStatus: "unverified" | "operator_confirmed";
  extendedContractConfirmationSha256: string | null;
  confirmExtendedContractRequested: boolean;
  operatorReferenceProvided: boolean;
}): BaselineReplacementPlan {
  const add: string[] = [];
  const update: string[] = [];
  const retain: string[] = [];
  const archive: string[] = [];
  const quarantine: string[] = [...input.quarantinedGuids].sort();

  for (const guid of input.acceptedGuids) {
    if (!input.existingAllGuids.has(guid)) {
      add.push(guid);
    } else if (input.existingActiveGuids.has(guid)) {
      retain.push(guid);
    } else {
      update.push(guid);
    }
  }

  for (const guid of input.existingActiveGuids) {
    if (!input.acceptedGuids.has(guid) && !input.quarantinedGuids.has(guid)) {
      archive.push(guid);
    }
  }

  const blockers: string[] = [];
  const confirmationRequired = input.confirmExtendedContractRequested;
  if (
    input.mode === "apply" &&
    input.confirmExtendedContractRequested &&
    !input.operatorReferenceProvided
  ) {
    blockers.push("missing_operator_reference");
  }
  if (!input.migrationReadiness.ready) {
    blockers.push("migrations_not_ready");
  }
  if (input.excludedArchiveDependencies.anyUnknownDependency) {
    blockers.push("archive_dependency_baseline_incomplete");
  }

  return {
    mode: input.mode,
    clientsSourceSha256: input.clientsSourceSha256,
    rosterSourceSha256: input.rosterSourceSha256,
    quarantineManifestSha256: input.quarantineManifestSha256,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    acceptedRecordCount: input.acceptedGuids.size,
    quarantinedRecordCount: input.quarantinedGuids.size,
    incomingRecordCount: input.incomingGuids.size,
    existingActiveCount: input.existingActiveGuids.size,
    fingerprint: input.fingerprint,
    operations: {
      add: bucket(add),
      update: bucket(update),
      retain: bucket(retain),
      archive: bucket(archive),
      quarantine: bucket(quarantine),
    },
    dependencyReport: input.dependencyReport,
    acceptedProjection: input.acceptedProjection,
    migrationReadiness: input.migrationReadiness,
    excludedArchiveDependencies: input.excludedArchiveDependencies,
    extendedContract: {
      status: input.extendedContractStatus,
      confirmationRequired,
      confirmationSha256: input.extendedContractConfirmationSha256,
    },
    applyAllowed: blockers.length === 0,
    blockers,
  };
}
