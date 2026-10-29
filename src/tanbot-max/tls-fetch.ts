import fs from "fs";
import { Agent, type Dispatcher } from "undici";

const TLS_ERROR_PATTERN =
  /unable to get local issuer certificate|self signed certificate|certificate|UNABLE_TO_VERIFY|CERT_|ERR_SSL|TLS/i;

export function readMaxTlsCaBundle(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.TANBOT_MAX_TLS_CA_BUNDLE?.trim();
  if (!raw) return null;
  if (!fs.existsSync(raw)) {
    throw new Error("TANBOT_MAX_TLS_CA_BUNDLE path does not exist.");
  }
  const stat = fs.statSync(raw);
  if (!stat.isFile()) {
    throw new Error("TANBOT_MAX_TLS_CA_BUNDLE must point to a PEM file.");
  }
  return fs.readFileSync(raw);
}

export function createMaxDispatcher(caBundle: Buffer | null): Dispatcher | undefined {
  if (!caBundle) return undefined;
  return new Agent({ connect: { ca: caBundle } });
}

export function isLikelyTlsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string; cause?: unknown };
  if (err.code && /ERR_SSL|UNABLE_TO_VERIFY|CERT_/i.test(err.code)) return true;
  if (typeof err.message === "string" && TLS_ERROR_PATTERN.test(err.message)) return true;
  if (err.cause) return isLikelyTlsError(err.cause);
  return false;
}

export function wrapFetchWithMaxTls(
  fetchImpl: typeof fetch,
  dispatcher: Dispatcher | undefined,
): typeof fetch {
  if (!dispatcher) return fetchImpl;
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, { ...init, dispatcher } as RequestInit)) as typeof fetch;
}
