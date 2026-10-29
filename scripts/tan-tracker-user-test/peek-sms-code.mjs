#!/usr/bin/env node
/**
 * Operator helper: read last test SMS code file (isolated user-test env only).
 * Usage: node scripts/tan-tracker-user-test/peek-sms-code.mjs <transferId> <partyId>
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const transferId = process.argv[2]?.trim();
const partyId = process.argv[3]?.trim();
const otpDir =
  process.env.TT_USER_TEST_OTP_DIR?.trim() ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../var/tt56-user-test/otp");

if (transferId && partyId) {
  const file = path.join(otpDir, `${transferId}_${partyId}.json`);
  try {
    const row = JSON.parse(readFileSync(file, "utf8"));
    console.log(JSON.stringify({ transferId, partyId, code: row.code ?? null, createdAt: row.createdAt }));
    process.exit(row.code ? 0 : 1);
  } catch {
    console.error("No OTP file for this transfer/party");
    process.exit(1);
  }
}

try {
  const files = readdirSync(otpDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) {
    console.log("No OTP files yet. Trigger phone/send in UI first.");
    process.exit(0);
  }
  const latest = JSON.parse(readFileSync(path.join(otpDir, files[0]), "utf8"));
  console.log(JSON.stringify(latest, null, 2));
} catch {
  console.error(`OTP directory not found: ${otpDir}`);
  process.exit(1);
}
