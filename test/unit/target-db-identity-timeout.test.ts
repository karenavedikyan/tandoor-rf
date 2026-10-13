import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolClient } from "pg";
import {
  isPgTransportOrQueryTimeout,
  readTargetDbIdentityFromClient,
  shouldDiscardPgClientAfterError,
  TargetDbIdentityError,
} from "../../src/onec-exchange-v3/target-db-identity";

describe("target db identity timeout classification", () => {
  it("preserves discardConnection after Query read timeout is wrapped", async () => {
    const client = {
      query: async () => {
        throw new Error("Query read timeout");
      },
    } as unknown as PoolClient;
    await assert.rejects(
      () => readTargetDbIdentityFromClient(client),
      (error: unknown) => {
        assert.ok(error instanceof TargetDbIdentityError);
        assert.equal(error.code, "TARGET_DB_IDENTITY_TIMEOUT");
        assert.equal(error.timeoutKind, "client_transport");
        assert.equal(error.discardConnection, true);
        assert.equal(shouldDiscardPgClientAfterError(error), true);
        return true;
      },
    );
  });

  it("does not discard connection for server statement_timeout", async () => {
    const client = {
      query: async () => {
        throw new Error("canceling statement due to statement timeout");
      },
    } as unknown as PoolClient;
    await assert.rejects(
      () => readTargetDbIdentityFromClient(client),
      (error: unknown) => {
        assert.ok(error instanceof TargetDbIdentityError);
        assert.equal(error.timeoutKind, "server_statement");
        assert.equal(error.discardConnection, false);
        assert.equal(shouldDiscardPgClientAfterError(error), false);
        return true;
      },
    );
  });

  it("shouldDiscardPgClientAfterError is false for wrapped user-facing timeout message only", () => {
    const wrapped = new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "Превышено время чтения идентичности БД",
      { timeoutKind: "client_transport", discardConnection: true, cause: new Error("Query read timeout") },
    );
    assert.equal(shouldDiscardPgClientAfterError(wrapped), true);
    assert.equal(isPgTransportOrQueryTimeout(wrapped), false);
  });
});
