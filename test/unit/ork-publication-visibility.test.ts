import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOrkPublicationAlignedWithTask } from "../../src/bitrix24/claims/ork-publication-visibility";

describe("ork publication visibility", () => {
  it("requires matching cache generation and binding for ork_sync", () => {
    assert.equal(
      isOrkPublicationAlignedWithTask(
        {
          cacheVersion: 3,
          objectType: "holding",
          objectGuid: "44444444-4444-4444-8444-444444444444",
          bindingStatus: "confirmed",
        },
        {
          briefText: "text",
          confirmedAt: "2026-09-30T09:00:00.000Z",
          publicationOrigin: "ork_sync",
          taskCacheVersion: 2,
          objectType: "holding",
          objectGuid: "44444444-4444-4444-8444-444444444444",
        },
      ),
      false,
    );
    assert.equal(
      isOrkPublicationAlignedWithTask(
        {
          cacheVersion: 2,
          objectType: "holding",
          objectGuid: "44444444-4444-4444-8444-444444444444",
          bindingStatus: "confirmed",
        },
        {
          briefText: "text",
          confirmedAt: "2026-09-30T09:00:00.000Z",
          publicationOrigin: "ork_sync",
          taskCacheVersion: 2,
          objectType: "holding",
          objectGuid: "44444444-4444-4444-8444-444444444444",
        },
      ),
      true,
    );
  });
});
