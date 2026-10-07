/**
 * Read-only audit of exchange JSON keys (fixtures + optional local paths).
 * Does not run import/apply.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateClientsFileBytes } from "../src/onec-clients/validate";
import { parseWholesaleEmployeeRosterBytes } from "../src/onec-clients/employee-roster";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../test/helpers/onec-clients-extended-fixtures";

function collectKeys(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value === null || value === undefined) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, prefix ? `${prefix}[]` : "[]", out);
    }
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out.add(path);
      collectKeys(child, path, out);
    }
  }
  return out;
}

function auditClients(bytes: Buffer, label: string, scanAll = false): Set<string> {
  const validated = validateClientsFileBytes(bytes);
  console.log(`\n=== ${label} ===`);
  const keys = new Set<string>();
  if (!validated.ok) {
    console.log("validate: FAIL", validated.errors?.slice(0, 5));
    return keys;
  }
  const parsedJson = JSON.parse(bytes.toString("utf8")) as unknown[];
  const records = Array.isArray(parsedJson) ? parsedJson : [];
  console.log("validate: OK", "records:", validated.payload.records.length);
  const sample = scanAll ? records : records.slice(0, Math.min(records.length, 50));
  for (const record of sample) {
    collectKeys(record, "", keys);
  }
  console.log(`observed keys (${scanAll ? "all" : "first " + sample.length} records):`);
  [...keys].sort().forEach((k) => console.log(" ", k));
  return keys;
}

function auditEmployees(bytes: Buffer, label: string): void {
  console.log(`\n=== ${label} ===`);
  const parsed = parseWholesaleEmployeeRosterBytes(bytes);
  if (!parsed.ok) {
    console.log("roster: FAIL", parsed.error);
    return;
  }
  console.log("roster: OK", "employees:", parsed.roster.length);
  const keys = new Set<string>();
  for (const employee of parsed.roster) {
    if (employee.rawJson) {
      collectKeys(employee.rawJson, "", keys);
    }
  }
  console.log("observed employee keys (union):");
  [...keys].sort().forEach((k) => console.log(" ", k));
}

const fixtureDir = join(process.cwd(), "test/fixtures/onec-clients");

if (existsSync(join(fixtureDir, "valid-two-records.json"))) {
  auditClients(readFileSync(join(fixtureDir, "valid-two-records.json")), "fixture valid-two-records (legacy)");
}
if (existsSync(join(fixtureDir, "extra-unknown-fields.json"))) {
  auditClients(readFileSync(join(fixtureDir, "extra-unknown-fields.json")), "fixture extra-unknown-fields (legacy)");
}

const extendedBytes = buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
auditClients(extendedBytes, "synthetic extended_v1 (confirmed test contract)", true);

const localClients = process.env.AUDIT_CLIENTS_PATH;
const localEmployees = process.env.AUDIT_EMPLOYEES_PATH;
if (localClients && existsSync(localClients)) {
  auditClients(readFileSync(localClients), `local ${localClients}`, true);
} else {
  console.log("\n(local all_clients.json: set AUDIT_CLIENTS_PATH to audit live file)");
}
if (localEmployees && existsSync(localEmployees)) {
  auditEmployees(readFileSync(localEmployees), `local ${localEmployees}`);
} else {
  console.log("(local all_employees.json: set AUDIT_EMPLOYEES_PATH to audit live file)");
}

console.log("\nNote: TOP-150/350/500, legal entities, category levels — not observed in confirmed fixtures; see docs/delivery/sprint2-field-map.md");
