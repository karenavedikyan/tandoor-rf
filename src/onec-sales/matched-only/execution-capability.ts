export type MatchedOnlyExecutionChannel = "test" | "production";

export type MatchedOnlyExecutionCapability = {
  readonly channel: MatchedOnlyExecutionChannel;
  readonly token: string;
};

const TEST_TOKEN = "matched-only-test-channel";
const PRODUCTION_TOKEN = "matched-only-production-channel";

export function createTestExecutionCapability(): MatchedOnlyExecutionCapability {
  return { channel: "test", token: TEST_TOKEN };
}

export function createProductionExecutionCapability(): MatchedOnlyExecutionCapability {
  return { channel: "production", token: PRODUCTION_TOKEN };
}

export function assertExecutionCapability(capability: MatchedOnlyExecutionCapability): void {
  if (capability.token !== TEST_TOKEN && capability.token !== PRODUCTION_TOKEN) {
    throw new Error("INVALID_EXECUTION_CAPABILITY");
  }
}
