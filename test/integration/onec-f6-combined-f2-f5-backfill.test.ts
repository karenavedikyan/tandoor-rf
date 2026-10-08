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
const LPR_NAME = "F6-LPR-PRESERVE";
const BACKFILL_CODE = "0012345";

const testConfig: RegularUpdateConfig = {
  stabilityDelayMs: 0,
  readRetries: 0,
  readDeadlineMs: 60_000,
  holdingLinkValidationPolicy: "tolerant",
};

const EXPECTED_WHOLESALE = { top150: "Нет", outletCategory: "D" };
const EXPECTED_COUNTERPARTY = {
  counterparty: "ООО «F6 Backfill»",
  legalEntityType: "Компания",
  ogrn: "0123456789012",
  fullName: "F6 Full Legal Name",
};
const EXPECTED_CONTRACT = {
  primaryContract: "Договор F6",
  mainAgreement: "Соглашение F6",
};

const EXPECTED_LPR = {
  name: LPR_NAME,
  post: "Owner",
  dateOfBirth: "1990-01-15",
  phone: "+79000000001",
  email: "f6-lpr@example.test",
  bonus: "0",
  conditionsBonus: "F6 terms",
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
  await storeOperatorExtendedConfirmation(databaseUrl, clientsBytes, rosterBytes, "f6-combined-test");
  const applied = await applyBundle(databaseUrl, clientsBytes, rosterBytes, dryRun.verificationFingerprint!);
  return { dryRun, applied };
}

function fullF1F5ClientRecord(overrides: Record<string, unknown> = {}) {
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
    [COUNTERPARTY_JSON_KEY_NAME]: "ООО «F6 Backfill»",
    [COUNTERPARTY_JSON_KEY_LEGAL_TYPE]: "Компания",
    [COUNTERPARTY_JSON_KEY_OGRN]: "0123456789012",
    [COUNTERPARTY_JSON_KEY_FULL_NAME]: "F6 Full Legal Name",
    [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: "Договор F6",
    [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: "Соглашение F6",
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
          name: LPR_NAME,
          post: "Owner",
          date_of_birth: "1990-01-15",
          phone: "+79000000001",
          email: "f6-lpr@example.test",
          bonus: "0",
          conditions_bonus: "F6 terms",
        },
        additional_information: { status_tandoor_club: "", bonus_tandoor_club: "0" },
      },
    ],
    ...overrides,
  };
}

async function simulatePreF6CommercialGap(databaseUrl: string, clientGuid: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      UPDATE onec_clients
      SET extended_snapshot = extended_snapshot
        - 'wholesaleExchange'
        - 'counterparty'
        - 'clientContract'
        - 'clientCode'
      WHERE guid_client = $1::uuid
    `,
    [clientGuid],
  );
  await pool.end();
}

async function readSnapshotSlice(databaseUrl: string, clientGuid: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ extended_snapshot: unknown }>(
    `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid`,
    [clientGuid],
  );
  await pool.end();
  return row.rows[0]?.extended_snapshot as Record<string, unknown> | undefined;
}

function lprFromSnapshot(snap: Record<string, unknown> | undefined) {
  const outlets = snap?.currentRetailOutlets as Array<{ lpr?: Record<string, unknown> }> | undefined;
  return outlets?.[0]?.lpr;
}

function normalizeLpr(lpr: Record<string, unknown> | undefined) {
  if (!lpr) {
    return lpr;
  }
  return {
    name: lpr.name,
    post: lpr.post,
    dateOfBirth: lpr.dateOfBirth,
    phone: lpr.phone,
    email: lpr.email,
    bonus: lpr.bonus,
    conditionsBonus: lpr.conditionsBonus,
  };
}

function assertLprBlockEqual(actual: Record<string, unknown> | undefined, expected: typeof EXPECTED_LPR) {
  assert.deepEqual(normalizeLpr(actual), expected);
}

function assertCommercialBlocks(snap: Record<string, unknown> | undefined) {
  const wholesale = snap?.wholesaleExchange as { top150: string; outletCategory: string };
  assert.equal(wholesale.top150, EXPECTED_WHOLESALE.top150);
  assert.equal(wholesale.outletCategory, EXPECTED_WHOLESALE.outletCategory);

  const counterparty = snap?.counterparty as typeof EXPECTED_COUNTERPARTY & {
    fieldPresence?: Record<string, boolean>;
  };
  assert.equal(counterparty.counterparty, EXPECTED_COUNTERPARTY.counterparty);
  assert.equal(counterparty.legalEntityType, EXPECTED_COUNTERPARTY.legalEntityType);
  assert.equal(counterparty.ogrn, EXPECTED_COUNTERPARTY.ogrn);
  assert.equal(counterparty.fullName, EXPECTED_COUNTERPARTY.fullName);

  const contract = snap?.clientContract as typeof EXPECTED_CONTRACT;
  assert.equal(contract.primaryContract, EXPECTED_CONTRACT.primaryContract);
  assert.equal(contract.mainAgreement, EXPECTED_CONTRACT.mainAgreement);

  const code = snap?.clientCode as { code1c: string };
  assert.equal(code.code1c, BACKFILL_CODE);
}

function commercialGapFingerprint(snap: Record<string, unknown> | undefined) {
  return {
    wholesaleExchange: snap?.wholesaleExchange,
    counterparty: snap?.counterparty,
    clientContract: snap?.clientContract,
    clientCode: snap?.clientCode,
    lpr: normalizeLpr(lprFromSnapshot(snap)),
  };
}

async function countSuccessfulApplyRuns(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const row = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE mode = 'apply' AND status = 'success'`,
  );
  await pool.end();
  return Number(row.rows[0]?.count ?? 0);
}

describe("onec F6 combined F2–F5 backfill preserves F1 LPR", { concurrency: false }, () => {
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

  it("backfills F2–F5 while keeping outlet LPR; repeat bundle → NO_CHANGES", async () => {
    const clientsBytes = clientsBytesFromRecord(fullF1F5ClientRecord());
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);

    let snap = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assertCommercialBlocks(snap);
    assertLprBlockEqual(lprFromSnapshot(snap), EXPECTED_LPR);
    const lprBeforeGap = normalizeLpr(lprFromSnapshot(snap));

    await simulatePreF6CommercialGap(databaseUrl, CLIENT_ONE);
    snap = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assert.deepEqual(commercialGapFingerprint(snap), {
      wholesaleExchange: undefined,
      counterparty: undefined,
      clientContract: undefined,
      clientCode: undefined,
      lpr: lprBeforeGap,
    });

    const backfillDry = await dryRunBundle(databaseUrl, clientsBytes, roster);
    const backfill = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(backfill.status, "SUCCESS");
    const countAfter = await countSuccessfulApplyRuns(databaseUrl);

    snap = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assertCommercialBlocks(snap);
    assertLprBlockEqual(lprFromSnapshot(snap), EXPECTED_LPR);
    assert.deepEqual(normalizeLpr(lprFromSnapshot(snap)), lprBeforeGap);

    const repeat = await applyBundle(
      databaseUrl,
      clientsBytes,
      roster,
      backfillDry.verificationFingerprint!,
    );
    assert.equal(repeat.status, "NO_CHANGES");
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), countAfter);
  });

  it("omitted Код preserves code; explicit empty clears; repeats → NO_CHANGES", async () => {
    const full = fullF1F5ClientRecord();
    const clientsBytes = clientsBytesFromRecord(full);
    const roster = rosterBytes();
    await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);

    const { [CLIENT_CODE_JSON_KEY]: _removed, ...withoutCode } = full;
    const omittedBytes = clientsBytesFromRecord(withoutCode);
    const omittedDry = await dryRunBundle(databaseUrl, omittedBytes, roster);
    assert.equal(
      (await applyBundle(databaseUrl, omittedBytes, roster, omittedDry.verificationFingerprint!)).status,
      "SUCCESS",
    );
    let code = (await readSnapshotSlice(databaseUrl, CLIENT_ONE))?.clientCode as { code1c: string };
    assert.equal(code.code1c, BACKFILL_CODE);
    assert.equal(
      (await applyBundle(databaseUrl, omittedBytes, roster, omittedDry.verificationFingerprint!)).status,
      "NO_CHANGES",
    );

    const clearedBytes = clientsBytesFromRecord(fullF1F5ClientRecord({ [CLIENT_CODE_JSON_KEY]: "" }));
    const clearedDry = await dryRunBundle(databaseUrl, clearedBytes, roster);
    await storeOperatorExtendedConfirmation(databaseUrl, clearedBytes, roster, "f6-combined-test");
    assert.equal(
      (await applyBundle(databaseUrl, clearedBytes, roster, clearedDry.verificationFingerprint!)).status,
      "SUCCESS",
    );
    code = (await readSnapshotSlice(databaseUrl, CLIENT_ONE))?.clientCode as { code1c: string };
    assert.equal(code.code1c, "");
    assert.equal(
      (await applyBundle(databaseUrl, clearedBytes, roster, clearedDry.verificationFingerprint!)).status,
      "NO_CHANGES",
    );
  });

  it("rolls back combined backfill after failed exchange-state update, then recovers", async () => {
    const clientsBytes = clientsBytesFromRecord(fullF1F5ClientRecord());
    const roster = rosterBytes();
    const { dryRun } = await dryRunAndApplyWithConfirmation(databaseUrl, clientsBytes, roster);
    await simulatePreF6CommercialGap(databaseUrl, CLIENT_ONE);
    const gapSnap = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assert.deepEqual(commercialGapFingerprint(gapSnap), {
      wholesaleExchange: undefined,
      counterparty: undefined,
      clientContract: undefined,
      clientCode: undefined,
      lpr: EXPECTED_LPR,
    });

    const applyCountBefore = await countSuccessfulApplyRuns(databaseUrl);
    let inTxnBlocks: {
      wholesale: unknown;
      counterparty: unknown;
      clientContract: unknown;
      clientCode: unknown;
    } | null = null;
    const failed = await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!, {
      afterRosterUpsert: async (client) => {
        const row = await client.query<{
          wholesale: unknown;
          counterparty: unknown;
          client_contract: unknown;
          client_code: unknown;
        }>(
          `
            SELECT
              extended_snapshot->'wholesaleExchange' AS wholesale,
              extended_snapshot->'counterparty' AS counterparty,
              extended_snapshot->'clientContract' AS client_contract,
              extended_snapshot->'clientCode' AS client_code
            FROM onec_clients
            WHERE guid_client = $1::uuid
          `,
          [CLIENT_ONE],
        );
        inTxnBlocks = {
          wholesale: row.rows[0]?.wholesale ?? null,
          counterparty: row.rows[0]?.counterparty ?? null,
          clientContract: row.rows[0]?.client_contract ?? null,
          clientCode: row.rows[0]?.client_code ?? null,
        };
      },
      failExchangeStateUpdate: true,
    });
    assert.equal(failed.status, "ERROR");
    assert.ok(inTxnBlocks);
    assert.equal((inTxnBlocks.wholesale as { top150: string }).top150, EXPECTED_WHOLESALE.top150);
    assert.equal(
      (inTxnBlocks.counterparty as { counterparty: string }).counterparty,
      EXPECTED_COUNTERPARTY.counterparty,
    );
    assert.equal(
      (inTxnBlocks.clientContract as { primaryContract: string }).primaryContract,
      EXPECTED_CONTRACT.primaryContract,
    );
    assert.equal((inTxnBlocks.clientCode as { code1c: string }).code1c, BACKFILL_CODE);

    const afterError = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assert.deepEqual(commercialGapFingerprint(afterError), commercialGapFingerprint(gapSnap));
    assert.equal(await countSuccessfulApplyRuns(databaseUrl), applyCountBefore);

    assert.equal(
      (await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!)).status,
      "SUCCESS",
    );
    const afterRecovery = await readSnapshotSlice(databaseUrl, CLIENT_ONE);
    assertCommercialBlocks(afterRecovery);
    assertLprBlockEqual(lprFromSnapshot(afterRecovery), EXPECTED_LPR);

    assert.equal(
      (await applyBundle(databaseUrl, clientsBytes, roster, dryRun.verificationFingerprint!)).status,
      "NO_CHANGES",
    );
  });
});
