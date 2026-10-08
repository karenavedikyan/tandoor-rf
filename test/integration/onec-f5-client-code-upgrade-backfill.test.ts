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
import { CLIENT_CODE_JSON_KEY } from "../../src/onec-clients/client-code-exchange-fields";
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
const BACKFILL_CODE = "0012345";

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

function rosterBytes() {
  return buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER_A)]);
}

async function dryRunAndApplyWithConfirmation(databaseUrl: string, clientsBytes: Buffer, rosterBytes: Buffer) {
  const dryRun = await dryRunBundle(databaseUrl, clientsBytes, rosterBytes);
  await storeOperatorExtendedConfirmation(databaseUrl, clientsBytes, rosterBytes, "f5-backfill-test");
  const applied = await applyBundle(databaseUrl, clientsBytes, rosterBytes, dryRun.verificationFingerprint!);
  return { dryRun, applied };
}

function extendedClientWithF5Bundle(overrides: Record<string, unknown> = {}) {
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
    [CLIENT_CODE_JSON_KEY]: BACKFILL_CODE,
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
      },
    ],
    ...overrides,
  };
}

async function simulatePreF5ClientCodeGap(databaseUrl: string, clientGuid: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `UPDATE onec_clients SET extended_snapshot = extended_snapshot - 'clientCode' WHERE guid_client = $1::uuid`,
    [clientGuid],
  );
  await pool.end();
}

async function readClientCodeBlock(databaseUrl: string, clientGuid: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ client_code: unknown }>(
    `SELECT extended_snapshot->'clientCode' AS client_code FROM onec_clients WHERE guid_client = $1::uuid`,
    [clientGuid],
  );
  await pool.end();
  return row.rows[0]?.client_code ?? null;
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("onec F5 client code upgrade backfill via regular-update", { concurrency: false }, () => {
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

  it("A: fills clientCode from unchanged file after pre-F5 snapshot gap", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF5Bundle());
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    await simulatePreF5ClientCodeGap(databaseUrl, CLIENT_ONE);
    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    const backfill = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    const applyCountAfterBackfill = await countSuccessfulApplyRuns(databaseUrl);
    assert.equal(backfill.status, "SUCCESS", backfill.message ?? backfill.errorCode);
    const block = (await readClientCodeBlock(databaseUrl, CLIENT_ONE)) as { code1c: string };
    assert.equal(block.code1c, BACKFILL_CODE);

    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountAfterBackfill);
  });

  it("C: omitted Код preserves value; explicit empty clears code1c", async () => {
    const full = extendedClientWithF5Bundle();
    const clientsBytes = clientsBytesFromRecord(full);
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);

    const { [CLIENT_CODE_JSON_KEY]: _c, ...withoutCode } = full;
    const omittedBytes = clientsBytesFromRecord(withoutCode);
    const omittedDry = await dryRunBundle(databaseUrl, omittedBytes, roster);
    const omittedApply = await applyBundle(
      databaseUrl,
      omittedBytes,
      roster,
      omittedDry.verificationFingerprint!,
    );
    assert.equal(omittedApply.status, "SUCCESS");
    let block = (await readClientCodeBlock(databaseUrl, CLIENT_ONE)) as { code1c: string };
    assert.equal(block.code1c, BACKFILL_CODE);
    const countAfterOmitted = await countSuccessfulApplyRuns(databaseUrl);
    const omittedRepeat = await applyBundle(
      databaseUrl,
      omittedBytes,
      roster,
      omittedDry.verificationFingerprint!,
    );
    assert.equal(omittedRepeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), countAfterOmitted);

    const clearedBytes = clientsBytesFromRecord(extendedClientWithF5Bundle({ [CLIENT_CODE_JSON_KEY]: "" }));
    const clearedDry = await dryRunBundle(databaseUrl, clearedBytes, roster);
    await storeOperatorExtendedConfirmation(databaseUrl, clearedBytes, roster, "f5-backfill-test");
    const clearedApply = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedApply.status, "SUCCESS");
    block = (await readClientCodeBlock(databaseUrl, CLIENT_ONE)) as { code1c: string };
    assert.equal(block.code1c, "");
    const countAfterEmptyString = await countSuccessfulApplyRuns(databaseUrl);
    const clearedRepeat = await applyBundle(
      databaseUrl,
      clearedBytes,
      roster,
      clearedDry.verificationFingerprint!,
    );
    assert.equal(clearedRepeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), countAfterEmptyString);

    const nullBytes = clientsBytesFromRecord(extendedClientWithF5Bundle({ [CLIENT_CODE_JSON_KEY]: null }));
    const nullDry = await dryRunBundle(databaseUrl, nullBytes, roster);
    await storeOperatorExtendedConfirmation(databaseUrl, nullBytes, roster, "f5-backfill-test");
    const nullApply = await applyBundle(databaseUrl, nullBytes, roster, nullDry.verificationFingerprint!);
    assert.equal(nullApply.status, "SUCCESS");
    block = (await readClientCodeBlock(databaseUrl, CLIENT_ONE)) as { code1c: string | null };
    assert.equal(block.code1c, null);
    const countAfterNull = await countSuccessfulApplyRuns(databaseUrl);
    const nullRepeat = await applyBundle(databaseUrl, nullBytes, roster, nullDry.verificationFingerprint!);
    assert.equal(nullRepeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), countAfterNull);
  });

  it("rejects invalid code type before apply and preserves stored snapshot", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF5Bundle());
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    const before = await readClientCodeBlock(databaseUrl, CLIENT_ONE);
    const countBefore = await countSuccessfulApplyRuns(databaseUrl);
    const invalidDry = await dryRunBundle(
      databaseUrl,
      clientsBytesFromRecord(extendedClientWithF5Bundle({ [CLIENT_CODE_JSON_KEY]: 0 })),
      roster,
    );
    assert.equal(invalidDry.status, "REJECTED_BY_CHECKS");
    assert.deepEqual(await readClientCodeBlock(databaseUrl, CLIENT_ONE), before);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), countBefore);
  });

  it("D: rolls back clientCode backfill after in-transaction write, then recovers", async () => {
    const clientsBytes = clientsBytesFromRecord(extendedClientWithF5Bundle());
    const roster = rosterBytes();
    const { dryRun } = await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    await simulatePreF5ClientCodeGap(databaseUrl, CLIENT_ONE);

    let afterRosterUpsertCalled = false;
    let inTxnBlock: unknown = null;
    const applyCountBeforeFailed = await countSuccessfulApplyRuns(databaseUrl);
    const failed = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!, {
      afterRosterUpsert: async (client) => {
        afterRosterUpsertCalled = true;
        const row = await client.query<{ client_code: unknown }>(
          `SELECT extended_snapshot->'clientCode' AS client_code FROM onec_clients WHERE guid_client = $1::uuid`,
          [CLIENT_ONE],
        );
        inTxnBlock = row.rows[0]?.client_code ?? null;
      },
      failExchangeStateUpdate: true,
    });
    assert.equal(failed.status, "ERROR");
    assert.equal(afterRosterUpsertCalled, true);
    assert.ok(inTxnBlock);
    assert.equal((inTxnBlock as { code1c: string }).code1c, BACKFILL_CODE);
    assert.equal(await readClientCodeBlock(databaseUrl, CLIENT_ONE), null);
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountBeforeFailed);

    assert.equal(
      (await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!)).status,
      "SUCCESS",
    );
    assert.equal(
      (await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!)).status,
      "NO_CHANGES",
    );
  });
});
