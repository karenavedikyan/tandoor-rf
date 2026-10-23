import { createHash } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { Pool } from "pg";
import { createPgPoolOptions } from "../../../config/pg-ssl";
import { resolveTargetDbIdentityFromUrl } from "../../../onec-exchange-v3/target-db-identity";
import { backupSha256 } from "../backup";
import { planHashFromPlan } from "../plan-build";
import { captureScopedBackup } from "../scoped-backup-capture";
import { withReadOnlyPreflightSession, PREFLIGHT_CONNECT_TIMEOUT_MS } from "./read-only-session";
import type { ExecutionManifestV2 } from "./manifest-types";
import { resolveProductionDatabaseUrl } from "./database-url";
import { validatePrivateCaptureManifestForRun } from "./manifest-capture-validate";
import { assertManifestCodeProvenance } from "./runtime-provenance";
import { assertCaptureDestinationAllowed, resolveCaptureApprovedPrivateRoot } from "./capture-path-policy";
import { EXPECTED_PRODUCTION_DB_FINGERPRINT } from "./target-policy";
import { isSyntheticVerifiedHarnessActive } from "./synthetic-harness-context";

export type PrivateBackupCaptureResult =
  | {
      ok: true;
      backupSha256: string;
      beforeStateSha256: string;
      planHash: string;
      destinationPath: string;
    }
  | { ok: false; code: string; message: string };

function assertCaptureTargetPolicy(
  manifest: ExecutionManifestV2,
  liveFingerprint: string,
  planFingerprint: string,
): { ok: true } | { ok: false; code: string; message: string } {
  const expectedTarget = manifest.target.expectedDbFingerprint;
  if (liveFingerprint !== planFingerprint) {
    return {
      ok: false,
      code: "CAPTURE_TARGET_IDENTITY_MISMATCH",
      message: "Live database identity does not match approved plan target fingerprint.",
    };
  }
  if (isSyntheticVerifiedHarnessActive()) {
    return { ok: true };
  }
  if (
    liveFingerprint !== expectedTarget ||
    planFingerprint !== expectedTarget ||
    expectedTarget !== EXPECTED_PRODUCTION_DB_FINGERPRINT
  ) {
    return {
      ok: false,
      code: "CAPTURE_TARGET_POLICY_MISMATCH",
      message: "Capture target must match manifest production allowlist fingerprint.",
    };
  }
  return { ok: true };
}

export async function capturePrivateBusinessBackupForManifest(input: {
  manifest: ExecutionManifestV2;
  approvedCaptureHash?: string;
}): Promise<PrivateBackupCaptureResult> {
  const captureCheck = validatePrivateCaptureManifestForRun({
    manifest: input.manifest,
    approvedCaptureHash: input.approvedCaptureHash,
  });
  if (!captureCheck.ok) {
    return captureCheck;
  }
  const plan = input.manifest.plan;
  const planHash = input.manifest.planHash;
  if (!plan || !planHash) {
    return { ok: false, code: "MANIFEST_PLAN_MISSING", message: "Capture requires embedded approved plan." };
  }
  if (planHashFromPlan(plan) !== planHash) {
    return { ok: false, code: "CAPTURE_PLAN_HASH_MISMATCH", message: "Manifest planHash does not match embedded plan." };
  }

  const provenance = await assertManifestCodeProvenance(
    input.manifest.provenance.codeArtifactLabel,
    input.manifest.provenance.expectedExecutableArtifactSha256,
    true,
  );
  if (!provenance.ok) {
    return provenance;
  }
  const destinationPath = input.manifest.privateBackupCapture!.destinationPath!;
  const approvedRoot = resolveCaptureApprovedPrivateRoot(input.manifest);
  if (!approvedRoot) {
    return { ok: false, code: "CAPTURE_ROOT_MISSING", message: "Approved private capture root is required." };
  }
  const urlResult = resolveProductionDatabaseUrl();
  if (!urlResult.ok) {
    return { ok: false, code: urlResult.code, message: urlResult.message };
  }
  const identity = await resolveTargetDbIdentityFromUrl(urlResult.databaseUrl);
  const targetPolicy = assertCaptureTargetPolicy(input.manifest, identity.fingerprint, plan.identity.targetDbFingerprint);
  if (!targetPolicy.ok) {
    return targetPolicy;
  }
  try {
    await assertCaptureDestinationAllowed(destinationPath, approvedRoot);
  } catch (error) {
    return {
      ok: false,
      code: "CAPTURE_DESTINATION_INVALID",
      message: error instanceof Error ? error.message : "Invalid capture destination.",
    };
  }

  const pgOptions = createPgPoolOptions(urlResult.databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: PREFLIGHT_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });

  try {
    const backup = await withReadOnlyPreflightSession(pool, async (client) => {
      const schema = await import("./schema-readiness").then((m) => m.assertMatchedOnlySchemaReady(client));
      if (!schema.ok) {
        throw new Error(schema.code);
      }
      const live = await import("../../../onec-exchange-v3/target-db-identity").then((m) =>
        m.readTargetDbIdentityFromClient(client, urlResult.databaseUrl),
      );
      const policy = assertCaptureTargetPolicy(input.manifest, live.fingerprint, plan.identity.targetDbFingerprint);
      if (!policy.ok) {
        throw new Error(policy.code);
      }
      return captureScopedBackup(client, plan);
    });
    if (backup.targetDbFingerprint !== identity.fingerprint) {
      return {
        ok: false,
        code: "CAPTURE_BACKUP_IDENTITY_MISMATCH",
        message: "Captured backup target fingerprint does not match live database.",
      };
    }
    const digest = backupSha256(backup);
    const payload = `${JSON.stringify(backup, null, 2)}\n`;
    let destHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      destHandle = await open(destinationPath, "wx", 0o600);
      await destHandle.writeFile(payload, { encoding: "utf8" });
      await destHandle.sync();
      await destHandle.close();
      destHandle = null;
      const readback = await readFile(destinationPath, "utf8");
      const readbackDigest = createHash("sha256").update(readback).digest("hex");
      const payloadDigest = createHash("sha256").update(payload).digest("hex");
      if (readbackDigest !== payloadDigest) {
        await unlink(destinationPath);
        return {
          ok: false,
          code: "CAPTURE_PUBLISH_VERIFY_FAILED",
          message: "Capture destination readback did not match written payload.",
        };
      }
    } catch (error) {
      await destHandle?.close().catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        return {
          ok: false,
          code: "CAPTURE_DESTINATION_EXISTS",
          message: "Backup destination already exists; exclusive capture refused.",
        };
      }
      await unlink(destinationPath).catch(() => undefined);
      throw error;
    }
    return {
      ok: true,
      backupSha256: digest,
      beforeStateSha256: backup.beforeStateSha256,
      planHash: backup.planHash,
      destinationPath,
    };
  } catch (error) {
    return {
      ok: false,
      code: "CAPTURE_FAILED",
      message: error instanceof Error ? error.message : "Private backup capture failed.",
    };
  } finally {
    await pool.end();
  }
}
