import { resolveProductionDatabaseUrl } from "./production/database-url";

export type MatchedOnlyExecutionChannel = "test" | "production";

/** Opaque channel binding — must be issued via issue* helpers, not constructed ad hoc. */
export type MatchedOnlyExecutionCapability = {
  readonly channel: MatchedOnlyExecutionChannel;
  readonly databaseUrl: string;
};

export function issueTestExecutionCapability(databaseUrl: string): MatchedOnlyExecutionCapability {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl || databaseUrl !== testUrl) {
    throw new Error("TEST_DATABASE_REQUIRED");
  }
  return { channel: "test", databaseUrl };
}

export function issueProductionExecutionCapability(databaseUrl: string): MatchedOnlyExecutionCapability {
  const resolved = resolveProductionDatabaseUrl();
  if (!resolved.ok || resolved.databaseUrl !== databaseUrl) {
    throw new Error("PRODUCTION_CHANNEL_VIOLATION");
  }
  return { channel: "production", databaseUrl };
}

export function assertExecutionCapability(
  capability: MatchedOnlyExecutionCapability,
  databaseUrl: string,
): void {
  if (capability.databaseUrl !== databaseUrl) {
    throw new Error("EXECUTION_CHANNEL_TARGET_MISMATCH");
  }
  if (capability.channel === "test") {
    const testUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testUrl || databaseUrl !== testUrl) {
      throw new Error("TEST_DATABASE_REQUIRED");
    }
    return;
  }
  const resolved = resolveProductionDatabaseUrl();
  if (!resolved.ok || resolved.databaseUrl !== databaseUrl) {
    throw new Error("PRODUCTION_CHANNEL_VIOLATION");
  }
}
