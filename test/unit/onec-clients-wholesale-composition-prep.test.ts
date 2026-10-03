import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyClientsImport } from "../../src/onec-clients/apply";
import {
  CLI_ARGUMENT_ERROR_MESSAGES,
  parseClientsImportCliArgs,
} from "../../src/onec-clients/cli-args";
import { rejectWholesaleCompositionPrepApply } from "../../src/onec-clients/wholesale-composition";
import { runClientsImport } from "../../src/onec-clients/run-import";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildClientsFileBytes,
  buildClientsFileSha256,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";
import { wholesaleRosterWithManagers } from "../helpers/onec-clients-employee-roster-fixtures";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";

describe("wholesale composition prep dry-run only", () => {
  it("rejects CLI apply combined with wholesale composition prep", () => {
    const hash = buildClientsFileSha256([sampleClient()]);
    const parsed = parseClientsImportCliArgs([
      "--apply",
      "--expected-sha256",
      hash,
      "--wholesale-composition-prep",
    ]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "APPLY_WITH_WHOLESALE_COMPOSITION_PREP");
      assert.equal(
        CLI_ARGUMENT_ERROR_MESSAGES[parsed.code],
        "--wholesale-composition-prep is dry-run only and cannot be combined with --apply.",
      );
    }
  });

  it("rejects direct apply service calls in prep mode before business writes", async () => {
    const bytes = buildClientsFileBytes([sampleClient()]);
    const validated = validateClientsFileBytes(bytes, {
      wholesaleCompositionMode: "replacement_prep",
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const before = await applyClientsImport({
      payload: validated.payload,
      wholesaleCompositionPrep: true,
    });
    assert.equal(before.ok, false);
    if (before.ok) return;
    assert.equal(before.code, "APPLY_BLOCKED");
  });

  it("rejects payload marked as replacement prep on direct apply", () => {
    const bytes = buildClientsFileBytes([sampleClient()]);
    const validated = validateClientsFileBytes(bytes, {
      wholesaleCompositionMode: "replacement_prep",
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const rejection = rejectWholesaleCompositionPrepApply({ payload: validated.payload });
    assert.ok(rejection);
    assert.equal(rejection?.code, "APPLY_BLOCKED");
  });

  it("keeps holding policy and roster sha on validated payload", () => {
    const rosterParse = parseWholesaleEmployeeRosterBytes(wholesaleRosterWithManagers());
    assert.equal(rosterParse.ok, true);
    if (!rosterParse.ok) return;
    const roster = rosterParse.roster;
    const bytes = buildClientsFileBytes([sampleClient()]);
    const validated = validateClientsFileBytes(bytes, {
      holdingLinkValidationPolicy: "strict",
      employeeRoster: roster,
      wholesaleCompositionMode: "replacement_prep",
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.payload.holdingLinkValidationPolicy, "strict");
    assert.equal(validated.payload.employeeRosterSourceSha256, roster.sourceSha256);
    assert.equal(validated.payload.extendedDiagnostics?.holdingLinkValidationPolicy, "strict");
    assert.equal(
      validated.payload.extendedDiagnostics?.employeeRosterSourceSha256,
      roster.sourceSha256,
    );
  });

  it("rejects explicitly provided invalid employee roster before validation success", async () => {
    const env = {
      ONEC_FTP_ENABLED: "true",
      ONEC_FTP_SECURITY: "plain",
      ONEC_FTP_HOST: "127.0.0.1",
      ONEC_FTP_PORT: "21",
      ONEC_FTP_USER: "lc_exchange",
      ONEC_FTP_PASSWORD: "test",
      ONEC_FTP_BASE_PATH: "/LC",
    };
    const result = await runClientsImport({
      env,
      argv: ["--dry-run", "--employee-roster", "/nonexistent/roster.json"],
      fileBytes: buildClientsFileBytes([sampleClient()]),
    });
    assert.equal(result.status, "ARGUMENT_ERROR");
    assert.equal(result.errorCode, "EMPLOYEE_ROSTER_UNREADABLE");
  });
});
