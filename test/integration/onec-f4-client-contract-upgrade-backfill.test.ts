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
  CLIENT_CONTRACT_JSON_KEY_AGREEMENT,
  CLIENT_CONTRACT_JSON_KEY_PRIMARY,
} from "../../src/onec-clients/client-contract-exchange-fields";
import {
  COUNTERPARTY_JSON_KEY_FULL_NAME,
  COUNTERPARTY_JSON_KEY_LEGAL_TYPE,
  COUNTERPARTY_JSON_KEY_NAME,
  COUNTERPARTY_JSON_KEY_OGRN,
} from "../../src/onec-clients/counterparty-exchange-fields";
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
) {
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

function clientsBytesFromRecord(record: Record<string, unknown>) {
  return buildExtendedClientsFileBytes([record]);
}

function rosterBytes(extraManagers: string[] = []) {
  const entries = [buildEmployeeRosterEntry(MANAGER_A)];
  for (const guid of extraManagers) {
    entries.push(buildEmployeeRosterEntry(guid));
  }
  return buildEmployeeRosterBytes(entries);
}

async function dryRunAndApplyWithConfirmation(
  databaseUrl: string,
  clientsBytes: Buffer,
  rosterBytes: Buffer,
  applyTestHooks?: Parameters<typeof runRegularUpdate>[0]["applyTestHooks"],
) {
  const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
  await storeOperatorExtendedConfirmation(databaseUrl, clientsBytes, rosterBytes, "f4-backfill-test");
  const applied = await applyBundle(
    databaseUrl,
    clientsBytes,
    rosterBytes,
    dryRun.verificationFingerprint!,
    applyTestHooks,
  );
  return { dryRun, applied };
}

function baseOutlet(overrides: Record<string, unknown> = {}) {
  return {
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
    LPR_information: {
      name: "",
      post: "",
      date_of_birth: "",
      phone: "",
      email: "",
      bonus: "",
      conditions_bonus: "",
    },
    additional_information: { status_tandoor_club: "", bonus_tandoor_club: "0" },
    ...overrides,
  };
}

function extendedClientWithF4Bundle(overrides: Record<string, unknown> = {}) {
  const { retail_outlets: outletOverrides, ...rest } = overrides;
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
    [COUNTERPARTY_JSON_KEY_NAME]: "ООО «Backfill»",
    [COUNTERPARTY_JSON_KEY_LEGAL_TYPE]: "Компания",
    [COUNTERPARTY_JSON_KEY_OGRN]: "0123456789012",
    [COUNTERPARTY_JSON_KEY_FULL_NAME]: "Backfill Full Legal Name",
    [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: "Договор Backfill F4",
    [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: "Соглашение Backfill F4",
    retail_outlets: Array.isArray(outletOverrides) ? outletOverrides : [baseOutlet()],
    ...rest,
  };
}

async function simulatePreF4ClientContractGap(databaseUrl: string, clientGuid: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      UPDATE onec_clients
      SET extended_snapshot = extended_snapshot - 'clientContract'
      WHERE guid_client = $1::uuid
    `,
    [clientGuid],
  );
  await pool.end();
}

async function readClientContractBlock(databaseUrl: string, clientGuid: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ client_contract: unknown }>(
    `
      SELECT extended_snapshot->'clientContract' AS client_contract
      FROM onec_clients
      WHERE guid_client = $1::uuid
    `,
    [clientGuid],
  );
  await pool.end();
  return row.rows[0]?.client_contract ?? null;
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("onec F4 client contract upgrade backfill via regular-update", { concurrency: false }, () => {
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

  it("A: fills clientContract fields from unchanged file after pre-F4 snapshot gap", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF4Bundle());
    const roster = rosterBytes();
    const { dryRun, applied: initial } = await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    assert.equal(dryRun.status, "SUCCESS");
    assert.equal(initial.status, "SUCCESS");
    assert.ok(await readClientContractBlock(databaseUrl, CLIENT_ONE));

    await simulatePreF4ClientContractGap(databaseUrl, CLIENT_ONE);
    assert.equal(await readClientContractBlock(databaseUrl, CLIENT_ONE), null);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    const backfill = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(backfill.status, "SUCCESS");

    const block = (await readClientContractBlock(databaseUrl, CLIENT_ONE)) as {
      primaryContract: string;
      mainAgreement: string;
    };
    assert.equal(block.primaryContract, "Договор Backfill F4");
    assert.equal(block.mainAgreement, "Соглашение Backfill F4");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), 2);
  });

  it("C: omitted F4 keys preserve values; explicit empty clears main agreement", async () => {
    const withContract = extendedClientWithF4Bundle();
    const clientsBytes = clientsBytesFromRecord(withContract);
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);

    const {
      [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: _p,
      [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: _a,
      ...withoutContract
    } = withContract;
    const omittedBytes = clientsBytesFromRecord(withoutContract);
    const omittedDry = await dryRunBundle(databaseUrl, omittedBytes, roster);
    const omittedApply = await applyBundle(
      databaseUrl,
      omittedBytes,
      roster,
      omittedDry.verificationFingerprint!,
    );
    assert.equal(omittedApply.status, "SUCCESS");
    let block = (await readClientContractBlock(databaseUrl, CLIENT_ONE)) as {
      primaryContract: string;
      mainAgreement: string;
    };
    assert.equal(block.primaryContract, "Договор Backfill F4");
    assert.equal(block.mainAgreement, "Соглашение Backfill F4");

    const omittedRepeat = await applyBundle(
      databaseUrl,
      omittedBytes,
      roster,
      omittedDry.verificationFingerprint!,
    );
    assert.equal(omittedRepeat.status, "NO_CHANGES");

    const clearedBytes = clientsBytesFromRecord(
      extendedClientWithF4Bundle({ [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: "" }),
    );
    const clearedDry = await dryRunBundle(databaseUrl, clearedBytes, roster);
    await storeOperatorExtendedConfirmation(databaseUrl, clearedBytes, roster, "f4-backfill-test");
    const clearedApply = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedApply.status, "SUCCESS");
    block = (await readClientContractBlock(databaseUrl, CLIENT_ONE)) as {
      primaryContract: string;
      mainAgreement: string;
    };
    assert.equal(block.primaryContract, "Договор Backfill F4");
    assert.equal(block.mainAgreement, "");

    const clearedRepeat = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedRepeat.status, "NO_CHANGES");
  });

  it("B: returns NO_CHANGES after clientContract backfill without another write", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF4Bundle());
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    await simulatePreF4ClientContractGap(databaseUrl, CLIENT_ONE);

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    await applyBundle(databaseUrl, clientsBytes, roster, backfillDry.verificationFingerprint!);

    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
  });

  it("rejects invalid clientContract field type before apply and preserves stored snapshot", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF4Bundle());
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    const before = await readClientContractBlock(databaseUrl, CLIENT_ONE);
    assert.ok(before);
    const applyCountBefore = await countSuccessfulApplyRuns(databaseUrl);

    const invalidBytes = clientsBytesFromRecord(
      extendedClientWithF4Bundle({ [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: 123 }),
    );
    const invalidDry = await dryRunBundle(databaseUrl, invalidBytes, roster);
    assert.equal(invalidDry.status, "REJECTED_BY_CHECKS");
    assert.equal(invalidDry.errorCode, "VALIDATION_FAILED");

    const after = await readClientContractBlock(databaseUrl, CLIENT_ONE);
    assert.deepEqual(after, before);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountBefore);
  });

  it("D: rolls back clientContract backfill after in-transaction write, then recovers", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF4Bundle());
    const roster = rosterBytes();
    const { dryRun } = await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    await simulatePreF4ClientContractGap(databaseUrl, CLIENT_ONE);
    assert.equal(await readClientContractBlock(databaseUrl, CLIENT_ONE), null);

    let afterRosterUpsertCalled = false;
    let inTxnBlock: unknown = null;
    const applyCountBeforeFailed = await countSuccessfulApplyRuns(databaseUrl);
    const failed = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!, {
      afterRosterUpsert: async (client) => {
        afterRosterUpsertCalled = true;
        const row = await client.query<{ client_contract: unknown }>(
          `
            SELECT extended_snapshot->'clientContract' AS client_contract
            FROM onec_clients
            WHERE guid_client = $1::uuid
          `,
          [CLIENT_ONE],
        );
        inTxnBlock = row.rows[0]?.client_contract ?? null;
      },
      failExchangeStateUpdate: true,
    });
    assert.equal(failed.status, "ERROR");
    assert.equal(afterRosterUpsertCalled, true, "afterRosterUpsert hook must run before forced failure");
    assert.ok(inTxnBlock, "inTxnBlock must be captured inside afterRosterUpsert");
    const inTxn = inTxnBlock as { primaryContract: string; mainAgreement: string };
    assert.equal(inTxn.primaryContract, "Договор Backfill F4");
    assert.equal(inTxn.mainAgreement, "Соглашение Backfill F4");
    assert.equal(await readClientContractBlock(databaseUrl, CLIENT_ONE), null);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountBeforeFailed);

    const recovered = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    assert.equal(recovered.status, "SUCCESS");
    const block = (await readClientContractBlock(databaseUrl, CLIENT_ONE)) as { primaryContract: string };
    assert.equal(block.primaryContract, "Договор Backfill F4");

    const repeat = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!);
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountBeforeFailed + 1);
  });
});
