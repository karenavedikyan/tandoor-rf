import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import {
  buildChecklistTree,
  computeChecklistProgress,
  dedupeChecklistItems,
  normalizeChecklistItem,
} from "../../src/bitrix24/normalize-checklist";
import { readBitrixChecklistForTask } from "../../src/bitrix24/read-checklist";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import {
  sampleChecklistItem,
  sampleChecklistRootGroup,
  sampleNestedChecklistResponse,
} from "../helpers/bitrix24-checklist-fixtures";

function operation(config: ReturnType<typeof sampleWebhookConfig>, pinnedRequest: unknown) {
  return {
    deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
    pinnedRequest,
    resolvePortalAddresses: createSafePortalResolver(),
  };
}

describe("bitrix24 checklist normalization", () => {
  it("ignores root groups and parent nodes in progress", () => {
    const raw = sampleNestedChecklistResponse();
    const items = dedupeChecklistItems(
      raw.map((entry) => normalizeChecklistItem(entry)).filter(Boolean) as NonNullable<
        ReturnType<typeof normalizeChecklistItem>
      >[],
    );
    assert.deepEqual(computeChecklistProgress(items), { completed: 2, total: 3 });
  });

  it("builds nested tree with stable ordering", () => {
    const raw = sampleNestedChecklistResponse();
    const items = raw
      .map((entry) => normalizeChecklistItem(entry))
      .filter(Boolean) as NonNullable<ReturnType<typeof normalizeChecklistItem>>[];
    const tree = buildChecklistTree(items);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.title, "Чек-лист 1");
    assert.equal(tree[0]?.isGroup, true);
    assert.equal(tree[0]?.children[0]?.title, "Найти документы");
    assert.equal(tree[0]?.children[1]?.children.length, 2);
  });

  it("rejects malformed completion flags", () => {
    assert.equal(
      normalizeChecklistItem({
        ...sampleChecklistItem({ id: "1", parentId: "431", title: "Broken" }),
        IS_COMPLETE: "maybe",
      }),
      null,
    );
  });
});

describe("bitrix24 checklist read transport", () => {
  it("paginates checklist pages and marks incomplete totals as partial", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const { pinnedRequest, calls } = createBitrixMockPinnedRequest({
      [url]: (body: { start?: number }) => ({
        body: {
          result: body.start === 0
            ? [sampleChecklistRootGroup(), sampleChecklistItem({ id: "433", parentId: "431", title: "A" })]
            : [sampleChecklistItem({ id: "447", parentId: "431", title: "B" })],
          next: body.start === 0 ? 50 : null,
          total: 4,
        },
      }),
    });
    const result = await readBitrixChecklistForTask(config, "9001", {
      operation: operation(config, pinnedRequest),
      maxPages: 5,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.items.length, 3);
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "TOTAL_MISMATCH");
      assert.equal(calls.length, 2);
    }
  });

  it("returns transport errors without fabricating checklist data", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: { status: 403, body: { error: "ACCESS_DENIED" } },
    });
    const result = await readBitrixChecklistForTask(config, "9001", {
      operation: operation(config, pinnedRequest),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FORBIDDEN");
    }
  });
});
