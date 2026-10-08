import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runRegularUpdate } from "../../src/onec-regular-update/run-update";
import type { RegularUpdateConfig } from "../../src/onec-regular-update/config";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { sha256Hex } from "../../src/onec-clients/sha256";
import { sampleClient } from "../helpers/onec-clients-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";
import { buildExtendedClientsFileBytes } from "../helpers/onec-clients-extended-fixtures";
import {
  WHOLESALE_JSON_KEY_OUTLET_CATEGORY,
  WHOLESALE_JSON_KEY_TOP150,
} from "../../src/onec-clients/wholesale-client-exchange-fields";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { storeExtendedContractConfirmation } from "../../src/onec-clients/baseline-replacement-db";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const OUTLET_ONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const testConfig: RegularUpdateConfig = {
  stabilityDelayMs: 0,
  readRetries: 0,
  readDeadlineMs: 60_000,
  holdingLinkValidationPolicy: "tolerant",
};

function ftpEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ONEC_FTP_ENABLED: "true",
    ONEC_FTP_SECURITY: "plain",
    ONEC_FTP_HOST: "127.0.0.1",
    ONEC_FTP_PORT: "21",
    ONEC_FTP_USER: "lc_exchange",
    ONEC_FTP_PASSWORD: "test-password",
    ONEC_FTP_BASE_PATH: "/LC",
    ONEC_FTP_TIMEOUT_MS: "15000",
  };
}

function bundle(clientsBytes: Buffer, rosterBytes: Buffer) {
  return {
    clientsBytes,
    rosterBytes,
    manifestBytes: buildExportManifestBytes({
      clientsSha256: sha256Hex(clientsBytes),
      rosterSha256: sha256Hex(rosterBytes),
    }),
  };
}

async function storeOperatorExtendedConfirmation(
  databaseUrl: string,
  clientsBytes: Buffer,
  rosterBytes: Buffer,
  operatorReference: string,
): Promise<string> {
  const parsedRoster = parseWholesaleEmployeeRosterBytes(rosterBytes);
  assert.equal(parsedRoster.ok, true, JSON.stringify(parsedRoster));
  const validated = validateClientsFileBytes(clientsBytes, {
    employeeRoster: parsedRoster.ok ? parsedRoster.roster : undefined,
    employeeRosterExplicit: true,
    holdingLinkValidationPolicy: "tolerant",
  });
  assert.equal(validated.ok, true, JSON.stringify(validated));
  if (!validated.ok) {
    return "";
  }
  const fingerprint = verificationFingerprintFromPayload({ payload: validated.payload });
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await storeExtendedContractConfirmation(pool, {
    clientsSourceSha256: validated.payload.sha256,
    verificationFingerprint: fingerprint,
    operatorReference,
    confirmationSha256: "",
  });
  await pool.end();
  return fingerprint;
}

async function dryRunBundle(databaseUrl: string, clientsBytes: Buffer, rosterBytes: Buffer) {
  const input = bundle(clientsBytes, rosterBytes);
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--dry-run"],
    config: testConfig,
    clientsBytes: input.clientsBytes,
    employeeRosterBytes: input.rosterBytes,
    manifestBytes: input.manifestBytes,
  });
}

async function applyBundle(
  databaseUrl: string,
  clientsBytes: Buffer,
  rosterBytes: Buffer,
  expectedFingerprint: string,
  applyTestHooks?: Parameters<typeof runRegularUpdate>[0]["applyTestHooks"],
  options?: { skipConfirmation?: boolean },
) {
  if (!options?.skipConfirmation) {
    await storeOperatorExtendedConfirmation(databaseUrl, clientsBytes, rosterBytes, "f2-backfill-test");
  }
  const input = bundle(clientsBytes, rosterBytes);
  return runRegularUpdate({
    env: ftpEnv(databaseUrl),
    argv: ["--apply", "--expected-fingerprint", expectedFingerprint],
    config: testConfig,
    clientsBytes: input.clientsBytes,
    employeeRosterBytes: input.rosterBytes,
    manifestBytes: input.manifestBytes,
    applyTestHooks,
  });
}

function extendedClientWithWholesale(overrides: Record<string, unknown> = {}) {
  return {
    ...sampleClient({ guid_manager: MANAGER_A, name_manager: "Manager One" }),
    holding: false,
    guid_regional_manager: "",
    name_regional_manager: "",
    guid_hardware_manager: "",
    name_hardware_manager: "",
    guid_head_of_the_sales_department: "",
    name_head_of_the_sales_department: "",
    [WHOLESALE_JSON_KEY_TOP150]: "Нет",
    [WHOLESALE_JSON_KEY_OUTLET_CATEGORY]: "D",
    retail_outlets: [
      {
        guid_store: OUTLET_ONE,
        closed: false,
        holding: "",
        warehouse: false,
        address: { store_address: "Store", delivery_address: "", direction_of_the_route: "" },
        managers: {
          guid_manager: MANAGER_A,
          name_manager: "Manager One",
          guid_regional_manager: "",
          name_regional_manager: "",
          guid_hardware_manager: "",
          name_hardware_manager: "",
          guid_head_of_the_sales_department: "",
          name_head_of_the_sales_department: "",
        },
        contact_information: { store_phone: "", accountant_phone: "", accountant_email: "" },
        LPR_information: {},
        additional_information: { status_tandoor_club: "", bonus_tandoor_club: "0" },
      },
    ],
    ...overrides,
  };
}

function clientsBytesFromRecord(record: Record<string, unknown>) {
  return buildExtendedClientsFileBytes([record]);
}

function rosterBytes() {
  return buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER_A)]);
}

async function simulatePreF2WholesaleGap(databaseUrl: string, clientGuid: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      UPDATE onec_clients
      SET extended_snapshot = extended_snapshot - 'wholesaleExchange'
      WHERE guid_client = $1::uuid
    `,
    [clientGuid],
  );
  await pool.end();
}

async function readWholesaleExchange(databaseUrl: string, clientGuid: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ wholesale: unknown }>(
    `
      SELECT extended_snapshot->'wholesaleExchange' AS wholesale
      FROM onec_clients
      WHERE guid_client = $1::uuid
    `,
    [clientGuid],
  );
  await pool.end();
  return row.rows[0]?.wholesale ?? null;
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("onec F2 wholesale upgrade backfill via regular-update", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("A: fills wholesale fields from unchanged file after pre-F2 snapshot gap", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithWholesale());
    const roster = rosterBytes();
    await storeOperatorExtendedConfirmation(databaseUrl, clientsBytes, roster, "f2-backfill-test");
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, roster);
    assert.equal(dryRun.status, "SUCCESS");

    const initial = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    assert.equal(initial.status, "SUCCESS");
    assert.ok(await readWholesaleExchange(databaseUrl, CLIENT_ONE));

    await simulatePreF2WholesaleGap(databaseUrl, CLIENT_ONE);
    assert.equal(await readWholesaleExchange(databaseUrl, CLIENT_ONE), null);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    const backfill = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(backfill.status, "SUCCESS");

    const wholesale = await readWholesaleExchange(databaseUrl, CLIENT_ONE) as {
      top150: string;
      outletCategory: string;
      fieldPresence: { top150: boolean; outletCategory: boolean };
    };
    assert.equal(wholesale.top150, "Нет");
    assert.equal(wholesale.outletCategory, "D");
    assert.equal(wholesale.fieldPresence.top150, true);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
    assert.equal(backfillDry.verificationFingerprint, dryRun.verificationFingerprint);
  });

  it("B: returns NO_CHANGES after wholesale backfill without another write", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithWholesale());
    const roster = rosterBytes();
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, roster);
    await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    await simulatePreF2WholesaleGap(databaseUrl, CLIENT_ONE);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    await applyBundle(databaseUrl, clientsBytes, roster, backfillDry.verificationFingerprint!);

    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
  });

  it("C: omitted wholesale keys preserve values; explicit empty clears category", async () => {
    const withWholesale = extendedClientWithWholesale();
    const clientsBytes = clientsBytesFromRecord(withWholesale);
    const roster = rosterBytes();
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, roster);
    await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);

    const { [WHOLESALE_JSON_KEY_TOP150]: _t, [WHOLESALE_JSON_KEY_OUTLET_CATEGORY]: _c, ...withoutWholesale } =
      withWholesale;
    const omittedBytes = clientsBytesFromRecord(withoutWholesale);
    const omittedDry = await dryRunBundle(databaseUrl, omittedBytes, roster);
    const omittedApply = await applyBundle(
      databaseUrl,
      omittedBytes,
      roster,
      omittedDry.verificationFingerprint!,
    );
    assert.equal(omittedApply.status, "NO_CHANGES");
    let wholesale = (await readWholesaleExchange(databaseUrl, CLIENT_ONE)) as {
      top150: string;
      outletCategory: string;
    };
    assert.equal(wholesale.top150, "Нет");
    assert.equal(wholesale.outletCategory, "D");

    const clearedBytes = clientsBytesFromRecord(
      extendedClientWithWholesale({ [WHOLESALE_JSON_KEY_OUTLET_CATEGORY]: "" }),
    );
    const clearedDry = await dryRunBundle(databaseUrl, clearedBytes, roster);
    const clearedApply = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedApply.status, "SUCCESS");
    wholesale = (await readWholesaleExchange(databaseUrl, CLIENT_ONE)) as {
      top150: string;
      outletCategory: string;
    };
    assert.equal(wholesale.top150, "Нет");
    assert.equal(wholesale.outletCategory, "");

    const clearedRepeat = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedRepeat.status, "NO_CHANGES");
  });

  it("D: rolls back wholesale backfill after in-transaction write, then recovers", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithWholesale());
    const roster = rosterBytes();
    const dryRun = await dryRunBundle(databaseUrl, clientsBytes, roster);
    await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    await simulatePreF2WholesaleGap(databaseUrl, CLIENT_ONE);
    assert.equal(await readWholesaleExchange(databaseUrl, CLIENT_ONE), null);

    let inTxnWholesale: unknown = null;
    const failed = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!, {
      afterRosterUpsert: async (client) => {
        const row = await client.query<{ wholesale: unknown }>(
          `
            SELECT extended_snapshot->'wholesaleExchange' AS wholesale
            FROM onec_clients
            WHERE guid_client = $1::uuid
          `,
          [CLIENT_ONE],
        );
        inTxnWholesale = row.rows[0]?.wholesale ?? null;
        assert.ok(inTxnWholesale);
      },
      failExchangeStateUpdate: true,
    });
    assert.equal(failed.status, "ERROR");
    assert.ok(inTxnWholesale);
    assert.equal(await readWholesaleExchange(databaseUrl, CLIENT_ONE), null);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 1);

    const recovered = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    assert.equal(recovered.status, "SUCCESS");
    const wholesale = (await readWholesaleExchange(databaseUrl, CLIENT_ONE)) as { outletCategory: string };
    assert.equal(wholesale.outletCategory, "D");

    const repeat = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
  });
});
