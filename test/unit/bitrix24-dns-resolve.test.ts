import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { resolvePortalAddressesSafely } from "../../src/bitrix24/dns-resolve";

describe("bitrix24 dns resolve", () => {
  it("rejects when any resolved address is private", async () => {
    await assert.rejects(
      resolvePortalAddressesSafely(
        "example.bitrix24.ru",
        OperationDeadline.fromDuration(1000),
        async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
      ),
    );
  });

  it("respects deadline during delayed DNS resolution", async () => {
    const startedAt = Date.now();
    await assert.rejects(
      resolvePortalAddressesSafely(
        "example.bitrix24.ru",
        OperationDeadline.fromDuration(200, startedAt),
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return [{ address: "93.184.216.34", family: 4 }];
        },
      ),
    );
    assert.ok(Date.now() - startedAt < 500);
  });
});
