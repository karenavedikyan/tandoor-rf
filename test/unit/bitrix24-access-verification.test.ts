import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLinkAccessValid } from "../../src/bitrix24/tasks/access";
import { loadBitrix24TasksRuntimeConfig } from "../../src/bitrix24/tasks/config";

describe("bitrix24 link access verification", () => {
  const runtime = loadBitrix24TasksRuntimeConfig({
    BITRIX24_CACHE_PUBLISH_ENABLED: "true",
    BITRIX24_CACHE_ACCESS_TTL_MS: "3600000",
    BITRIX24_LINK_VERIFICATION_TTL_MS: "3600000",
  });

  it("rejects future last_verified_at timestamps", () => {
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    assert.equal(
      isLinkAccessValid(
        {
          bitrixUserId: "42",
          confirmedAt: "2026-09-01T12:00:00.000Z",
          accessExpiresAt: null,
          lastVerifiedAt: "2099-01-01T00:00:00.000Z",
        },
        runtime,
        nowMs,
      ),
      false,
    );
  });

  it("rejects expired access_expires_at", () => {
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    assert.equal(
      isLinkAccessValid(
        {
          bitrixUserId: "42",
          confirmedAt: "2026-09-01T12:00:00.000Z",
          accessExpiresAt: "2026-09-15T12:00:00.000Z",
          lastVerifiedAt: "2026-09-20T12:00:00.000Z",
        },
        runtime,
        nowMs,
      ),
      false,
    );
  });

  it("rejects cleared last_verified_at after inactive verification", () => {
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    assert.equal(
      isLinkAccessValid(
        {
          bitrixUserId: "42",
          confirmedAt: "2026-09-01T12:00:00.000Z",
          accessExpiresAt: null,
          lastVerifiedAt: null,
        },
        runtime,
        nowMs,
      ),
      false,
    );
  });

  it("accepts fresh verification within TTL", () => {
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    assert.equal(
      isLinkAccessValid(
        {
          bitrixUserId: "42",
          confirmedAt: "2026-09-01T12:00:00.000Z",
          accessExpiresAt: null,
          lastVerifiedAt: "2026-10-01T11:00:00.000Z",
        },
        runtime,
        nowMs,
      ),
      true,
    );
  });
});
