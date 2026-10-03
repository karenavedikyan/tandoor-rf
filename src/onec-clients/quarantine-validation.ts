import type { ExtendedValidationIssue } from "./extended-types";
import type { ParsedExtendedClientRecord } from "./extended-types";
import {
  type QuarantineManifest,
  type QuarantineReason,
  quarantineManifestSha256,
  quarantinedGuidSet,
} from "./quarantine-manifest";

export type QuarantineDependencySample = {
  guidClient: string;
  dependencyType: "resolved_holding_link" | "holding_target";
  relatedGuid: string;
};

export type QuarantineValidationFailure =
  | { code: "MANIFEST_SOURCE_SHA_MISMATCH"; message: string }
  | { code: "QUARANTINE_ENTRY_NOT_IN_SOURCE"; message: string }
  | { code: "QUARANTINE_UNEXPECTED_ISSUE"; message: string; guidClient: string; issueCode: string }
  | { code: "QUARANTINE_MISSING_EXPECTED_ISSUE"; message: string; guidClient: string; expectedReason: QuarantineReason }
  | { code: "QUARANTINE_EXTRA_ISSUE"; message: string; guidClient: string; issueCode: string }
  | { code: "QUARANTINE_DEPENDENCY_BLOCKED"; message: string; dependencies: QuarantineDependencySample[] }
  | { code: "NON_QUARANTINE_VALIDATION_FAILED"; message: string; issueCount: number };

export type QuarantineValidationSuccess = {
  manifest: QuarantineManifest;
  manifestSha256: string;
  acceptedGuids: Set<string>;
  quarantinedGuids: Set<string>;
  dependencyReport: QuarantineDependencySample[];
};

function issuesByGuid(
  records: ParsedExtendedClientRecord[],
  issues: ExtendedValidationIssue[],
): Map<string, ExtendedValidationIssue[]> {
  const map = new Map<string, ExtendedValidationIssue[]>();
  for (const issue of issues) {
    if (issue.index === undefined) {
      continue;
    }
    const record = records[issue.index];
    if (!record) {
      continue;
    }
    const guid = record.guid_client.toLowerCase();
    const list = map.get(guid) ?? [];
    list.push(issue);
    map.set(guid, list);
  }
  return map;
}

function collectDependencyViolations(
  records: ParsedExtendedClientRecord[],
  quarantined: Set<string>,
): QuarantineDependencySample[] {
  const violations: QuarantineDependencySample[] = [];
  const byGuid = new Map(records.map((record) => [record.guid_client.toLowerCase(), record]));

  for (const record of records) {
    const clientGuid = record.guid_client.toLowerCase();
    if (quarantined.has(clientGuid)) {
      continue;
    }
    if (record.guid_holding) {
      const holdingGuid = record.guid_holding.toLowerCase();
      if (quarantined.has(holdingGuid) && record.holdingLinkState === "resolved") {
        violations.push({
          guidClient: clientGuid,
          dependencyType: "resolved_holding_link",
          relatedGuid: holdingGuid,
        });
      }
    }
    if (record.guid_holding) {
      const target = byGuid.get(record.guid_holding.toLowerCase());
      if (target && quarantined.has(target.guid_client.toLowerCase())) {
        violations.push({
          guidClient: clientGuid,
          dependencyType: "holding_target",
          relatedGuid: target.guid_client,
        });
      }
    }
  }

  return violations;
}

export function validateQuarantineAgainstIssues(input: {
  sourceSha256: string;
  manifest: QuarantineManifest;
  records: ParsedExtendedClientRecord[];
  issues: ExtendedValidationIssue[];
}): QuarantineValidationFailure | QuarantineValidationSuccess {
  if (input.manifest.sourceSha256.toLowerCase() !== input.sourceSha256.toLowerCase()) {
    return {
      code: "MANIFEST_SOURCE_SHA_MISMATCH",
      message: "Quarantine manifest sourceSha256 does not match clients file SHA256.",
    };
  }

  const sourceGuids = new Set(input.records.map((record) => record.guid_client.toLowerCase()));
  const quarantined = quarantinedGuidSet(input.manifest);
  for (const entry of input.manifest.entries) {
    if (!sourceGuids.has(entry.guidClient.toLowerCase())) {
      return {
        code: "QUARANTINE_ENTRY_NOT_IN_SOURCE",
        message: `Quarantine entry ${entry.guidClient} is not present in source file.`,
      };
    }
  }

  const grouped = issuesByGuid(input.records, input.issues);

  for (const [guid, guidIssues] of grouped) {
    if (!quarantined.has(guid)) {
      return {
        code: "NON_QUARANTINE_VALIDATION_FAILED",
        message: `Validation issue on non-quarantined client ${guid}.`,
        issueCount: input.issues.length,
      };
    }
  }

  for (const entry of input.manifest.entries) {
    const guid = entry.guidClient.toLowerCase();
    const guidIssues = grouped.get(guid) ?? [];
    const unexpected = guidIssues.filter((issue) => issue.code !== entry.reason);
    if (unexpected.length > 0) {
      return {
        code: "QUARANTINE_UNEXPECTED_ISSUE",
        message: `Quarantined client ${entry.guidClient} has unexpected issue ${unexpected[0]!.code}.`,
        guidClient: entry.guidClient,
        issueCode: unexpected[0]!.code,
      };
    }
    const expected = guidIssues.filter((issue) => issue.code === entry.reason);
    if (expected.length === 0) {
      return {
        code: "QUARANTINE_MISSING_EXPECTED_ISSUE",
        message: `Quarantined client ${entry.guidClient} no longer has expected ${entry.reason}; refresh manifest.`,
        guidClient: entry.guidClient,
        expectedReason: entry.reason,
      };
    }
    if (guidIssues.length !== 1) {
      return {
        code: "QUARANTINE_EXTRA_ISSUE",
        message: `Quarantined client ${entry.guidClient} has multiple issues; isolation requires exactly one expected error.`,
        guidClient: entry.guidClient,
        issueCode: guidIssues[1]?.code ?? entry.reason,
      };
    }
    if (entry.relatedGuid) {
      const record = input.records.find((row) => row.guid_client.toLowerCase() === guid);
      if (record?.guid_holding?.toLowerCase() !== entry.relatedGuid.toLowerCase()) {
        return {
          code: "QUARANTINE_UNEXPECTED_ISSUE",
          message: `Quarantined client ${entry.guidClient} holding link changed since manifest.`,
          guidClient: entry.guidClient,
          issueCode: entry.reason,
        };
      }
    }
  }

  if (input.issues.length > input.manifest.entries.length) {
    return {
      code: "NON_QUARANTINE_VALIDATION_FAILED",
      message: "Validation has issues outside quarantine manifest scope.",
      issueCount: input.issues.length,
    };
  }

  const dependencyReport = collectDependencyViolations(input.records, quarantined);
  if (dependencyReport.length > 0) {
    return {
      code: "QUARANTINE_DEPENDENCY_BLOCKED",
      message: "Non-quarantined clients depend on quarantined cards; resolve dependencies or expand manifest explicitly.",
      dependencies: dependencyReport,
    };
  }

  const acceptedGuids = new Set<string>();
  for (const record of input.records) {
    if (!quarantined.has(record.guid_client.toLowerCase())) {
      acceptedGuids.add(record.guid_client.toLowerCase());
    }
  }

  return {
    manifest: input.manifest,
    manifestSha256: quarantineManifestSha256(input.manifest),
    acceptedGuids,
    quarantinedGuids: quarantined,
    dependencyReport,
  };
}
