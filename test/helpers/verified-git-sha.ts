import { execSync } from "node:child_process";

function normalizeSha(value: string): string {
  return value.trim().slice(0, 7);
}

export function resolveVerifiedGitSha(options?: { envKeys?: string[] }): string {
  const checkout = normalizeSha(execSync("git rev-parse HEAD", { encoding: "utf8" }));
  const keys = options?.envKeys ?? [
    "CLIENTS_V3_VERIFIED_SHA",
    "CURSOR_VERIFIED_SHA",
    "GITHUB_SHA",
  ];
  for (const key of keys) {
    const fromEnv = process.env[key];
    if (!fromEnv) {
      continue;
    }
    const normalized = normalizeSha(fromEnv);
    if (normalized !== checkout) {
      throw new Error(
        `Verified SHA mismatch: ${key}=${normalized} does not match git checkout ${checkout}`,
      );
    }
    return checkout;
  }
  return checkout;
}
