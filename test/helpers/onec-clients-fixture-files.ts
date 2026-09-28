import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(process.cwd(), "test/fixtures/onec-clients");

export function loadClientsFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

export const CLIENTS_FIXTURE_NAMES = {
  validTwoRecords: "valid-two-records.json",
  emptyAddressPhones: "empty-address-and-phones.json",
  duplicateGuid: "duplicate-guid.json",
  invalidGuid: "invalid-guid.json",
  invalidTelephoneType: "invalid-telephone-type.json",
  extraUnknownFields: "extra-unknown-fields.json",
  holdingContractViolation: "holding-id-without-name.json",
  invalidJson: "invalid-json.json",
  truncatedJson: "truncated-json.json",
  repeatSnapshot: "repeat-snapshot.json",
} as const;
