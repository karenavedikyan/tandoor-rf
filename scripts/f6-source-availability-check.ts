/**
 * Read-only F6 source availability probe (no import, no prod writes).
 * Prints JSON aggregates without PII.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROD_CANDIDATE_PATHS = [
  "/LC/clients/all_clients.json",
  process.env.AUDIT_CLIENTS_PATH?.trim() || "",
].filter(Boolean);

const RECOVERED_FIXTURE = join(process.cwd(), "test/fixtures/onec-clients/recovered-exchange-structure.json");

type ProdProbe = {
  path: string;
  readable: boolean;
  bytes: number | null;
  mtimeUtc: string | null;
  sha256: string | null;
};

function probeFile(path: string): ProdProbe {
  if (!existsSync(path)) {
    return { path, readable: false, bytes: null, mtimeUtc: null, sha256: null };
  }
  try {
    const st = statSync(path);
    const bytes = readFileSync(path);
    return {
      path,
      readable: true,
      bytes: st.size,
      mtimeUtc: st.mtime.toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return { path, readable: false, bytes: null, mtimeUtc: null, sha256: null };
  }
}

function loadRecoveredMeta() {
  if (!existsSync(RECOVERED_FIXTURE)) {
    return { found: false as const };
  }
  const raw = JSON.parse(readFileSync(RECOVERED_FIXTURE, "utf8")) as {
    source?: string;
    capturedAt?: string;
    auditedAt?: string;
    historicalSnapshot?: boolean;
    freshFtpRead?: boolean;
    bytes?: number;
    sha256?: string;
    clients?: number;
    outlets?: number;
    fields?: Array<{ path: string; present: number; nonempty: number; types: string[] }>;
  };
  return {
    found: true as const,
    fixturePath: RECOVERED_FIXTURE,
    source: raw.source ?? null,
    capturedAt: raw.capturedAt ?? null,
    auditedAt: raw.auditedAt ?? null,
    historicalSnapshot: raw.historicalSnapshot ?? null,
    freshFtpRead: raw.freshFtpRead ?? null,
    bytes: raw.bytes ?? null,
    sha256: raw.sha256 ?? null,
    clients: raw.clients ?? null,
    outlets: raw.outlets ?? null,
    fieldFillRates: (raw.fields ?? []).map((f) => ({
      path: f.path,
      present: f.present,
      nonempty: f.nonempty,
      types: f.types,
    })),
  };
}

const report = {
  checkedAtUtc: new Date().toISOString(),
  agentNote:
    "Historical recovered fixture is not an current FTP export. Prod file absence on agent does not prove prod absence.",
  prodCandidates: PROD_CANDIDATE_PATHS.map(probeFile),
  recoveredAuditFixture: loadRecoveredMeta(),
};

console.log(JSON.stringify(report, null, 2));
