import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolClient } from "pg";
import {
  releaseCleanStartImportLock,
  rollbackCleanStartTransaction,
} from "../../src/onec-exchange-v3/clean-start";
import {
  finalizeOneOffIdentityClient,
  resetIdentityStatementTimeout,
  shouldDiscardPgClientAfterError,
  TargetDbIdentityError,
} from "../../src/onec-exchange-v3/target-db-identity";

function mockClient(handlers: {
  onQuery?: (text: string) => void | { throwError: Error };
}): PoolClient & { releaseCalls: boolean[]; queryTexts: string[] } {
  const queryTexts: string[] = [];
  const releaseCalls: boolean[] = [];
  const client = {
    queryTexts,
    releaseCalls,
    query: async (cfg: string | { text: string }) => {
      const text = typeof cfg === "string" ? cfg : cfg.text;
      queryTexts.push(text);
      const outcome = handlers.onQuery?.(text);
      if (outcome && "throwError" in outcome) {
        throw outcome.throwError;
      }
      return { rows: [] };
    },
    release: (discard?: boolean | Error) => {
      releaseCalls.push(discard === true);
    },
  };
  return client as unknown as PoolClient & { releaseCalls: boolean[]; queryTexts: string[] };
}

describe("clean start pooled/one-off client cleanup", () => {
  it("finalizeOneOffIdentityClient uses release(true) when RESET hits Query read timeout", async () => {
    const client = mockClient({
      onQuery: (text) => {
        if (text.includes("RESET statement_timeout")) {
          return { throwError: new Error("Query read timeout") };
        }
      },
    });

    const discard = await finalizeOneOffIdentityClient(client, false);
    assert.equal(discard, true);
    assert.deepEqual(client.releaseCalls, [true]);
    assert.equal(client.queryTexts.some((t) => t.includes("RESET statement_timeout")), true);
    assert.equal(client.queryTexts.length, 1);
  });

  it("preserves original identity failure when RESET cleanup times out", async () => {
    const client = mockClient({
      onQuery: (text) => {
        if (text.includes("RESET statement_timeout")) {
          return { throwError: new Error("Query read timeout") };
        }
      },
    });

    let identityPhaseDiscard = false;
    let identityFailureMessage: string | null = null;
    try {
      throw new TargetDbIdentityError(
        "TARGET_DB_IDENTITY_UNAVAILABLE",
        "original identity failure",
        { discardConnection: false },
      );
    } catch (error) {
      identityPhaseDiscard = shouldDiscardPgClientAfterError(error);
      identityFailureMessage = error instanceof TargetDbIdentityError ? error.message : "other";
    } finally {
      if (!identityPhaseDiscard) {
        try {
          await resetIdentityStatementTimeout(client);
        } catch (cleanupError) {
          if (shouldDiscardPgClientAfterError(cleanupError)) {
            identityPhaseDiscard = true;
          }
        }
      }
    }

    assert.equal(identityFailureMessage, "original identity failure");
    assert.equal(identityPhaseDiscard, true);
    assert.equal(client.queryTexts.length, 1);
  });

  it("releaseCleanStartImportLock returns discard on transport timeout", async () => {
    const client = mockClient({});
    const discard = await releaseCleanStartImportLock(client, {
      simulateLockReleaseTransportTimeout: true,
    });
    assert.equal(discard, true);
    assert.equal(client.queryTexts.length, 0);
  });

  it("rollbackCleanStartTransaction returns discard on Query read timeout", async () => {
    const client = mockClient({
      onQuery: () => ({ throwError: new Error("Query read timeout") }),
    });
    const discard = await rollbackCleanStartTransaction(client);
    assert.equal(discard, true);
    assert.deepEqual(client.queryTexts, ["ROLLBACK"]);
  });
});
