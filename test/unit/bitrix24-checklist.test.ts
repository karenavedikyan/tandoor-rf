import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import {
  buildChecklistTree,
  computeChecklistProgress,
  dedupeChecklistItems,
  normalizeChecklistItem,
  validateChecklistStructure,
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

function normalizeAll(raw: unknown[], taskId = "9001") {
  return raw
    .map((entry) => normalizeChecklistItem(entry, taskId))
    .filter(Boolean) as NonNullable<ReturnType<typeof normalizeChecklistItem>>[];
}

describe("bitrix24 checklist normalization", () => {
  it("counts nested actionable items and excludes only root checklist headers", () => {
    const items = dedupeChecklistItems(normalizeAll(sampleNestedChecklistResponse())).items;
    assert.deepEqual(computeChecklistProgress(items), { completed: 2, total: 4 });
  });

  it("keeps completion state on parent items that also have children", () => {
    const items = dedupeChecklistItems(normalizeAll(sampleNestedChecklistResponse())).items;
    const tree = buildChecklistTree(items);
    const section = tree[0]?.children.find((node) => node.id === "447");
    assert.equal(section?.isGroup, false);
    assert.equal(section?.isComplete, false);
    assert.equal(section?.children.length, 2);
  });

  it("extracts co-executors from TYPE A and ignores TYPE U observers", () => {
    const item = normalizeChecklistItem(
      sampleChecklistItem({
        id: "501",
        parentId: "431",
        title: "Согласовать",
        members: [
          { ID: "11", TYPE: "A", NAME: "Co Executor" },
          { ID: "12", TYPE: "U", NAME: "Observer" },
        ],
      }),
      "9001",
    );
    assert.deepEqual(item?.coExecutorBitrixIds, ["11"]);
  });

  it("rejects conflicting duplicate ids and invalid parents", () => {
    const duplicate = dedupeChecklistItems([
      ...normalizeAll([
        sampleChecklistRootGroup(),
        sampleChecklistItem({ id: "433", parentId: "431", title: "A" }),
      ]),
      ...normalizeAll([sampleChecklistItem({ id: "433", parentId: "431", title: "B" })]),
    ]);
    assert.equal(duplicate.duplicateConflict, true);

    const brokenParent = dedupeChecklistItems(
      normalizeAll([sampleChecklistItem({ id: "900", parentId: "999", title: "Orphan" })]),
    ).items;
    assert.deepEqual(validateChecklistStructure(brokenParent), { ok: false, code: "MISSING_PARENT" });
  });

  it("detects cycles instead of silently dropping items", () => {
    const cyclic = dedupeChecklistItems(
      normalizeAll([
        sampleChecklistRootGroup("431", "Root"),
        sampleChecklistItem({ id: "433", parentId: "447", title: "A" }),
        sampleChecklistItem({ id: "447", parentId: "433", title: "B" }),
      ]),
    ).items;
    assert.deepEqual(validateChecklistStructure(cyclic), { ok: false, code: "CYCLE" });
  });

  it("rejects invalid or missing PARENT_ID instead of treating them as root headers", () => {
    const base = sampleChecklistItem({ id: "501", parentId: "431", title: "Шаг" });
    for (const parentId of ["broken", -1, null] as const) {
      assert.equal(
        normalizeChecklistItem({ ...base, PARENT_ID: parentId }, "9001"),
        null,
      );
    }
    const missingParent = { ...base };
    delete (missingParent as { PARENT_ID?: unknown }).PARENT_ID;
    assert.equal(normalizeChecklistItem(missingParent, "9001"), null);
  });

  it("accepts only explicit zero PARENT_ID as root header", () => {
    for (const parentId of [0, "0"] as const) {
      const item = normalizeChecklistItem(
        { ...sampleChecklistRootGroup("431"), PARENT_ID: parentId },
        "9001",
      );
      assert.equal(item?.isRootGroup, true);
      assert.equal(item?.parentId, null);
    }
  });

  it("rejects malformed completion flags and foreign TASK_ID", () => {
    assert.equal(
      normalizeChecklistItem(
        {
          ...sampleChecklistItem({ id: "1", parentId: "431", title: "Broken" }),
          IS_COMPLETE: "maybe",
        },
        "9001",
      ),
      null,
    );
    assert.equal(
      normalizeChecklistItem(
        {
          ...sampleChecklistItem({ id: "1", parentId: "431", title: "Foreign" }),
          TASK_ID: "9002",
        },
        "9001",
      ),
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

  it("marks invalid PARENT_ID responses as incomplete instead of empty checklist", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const cases: Array<{ label: string; item: Record<string, unknown> }> = [
      {
        label: "broken",
        item: {
          ...sampleChecklistItem({ id: "901", parentId: "431", title: "Broken parent" }),
          PARENT_ID: "broken",
        },
      },
      {
        label: "-1",
        item: {
          ...sampleChecklistItem({ id: "901", parentId: "431", title: "Broken parent" }),
          PARENT_ID: -1,
        },
      },
      {
        label: "null",
        item: {
          ...sampleChecklistItem({ id: "901", parentId: "431", title: "Broken parent" }),
          PARENT_ID: null,
        },
      },
      {
        label: "missing",
        item: (() => {
          const item = {
            ...sampleChecklistItem({ id: "901", parentId: "431", title: "Broken parent" }),
          };
          delete (item as { PARENT_ID?: unknown }).PARENT_ID;
          return item;
        })(),
      },
    ];
    for (const testCase of cases) {
      const { pinnedRequest } = createBitrixMockPinnedRequest({
        [url]: {
          body: {
            result: [testCase.item],
            total: 1,
          },
        },
      });
      const result = await readBitrixChecklistForTask(config, "9001", {
        operation: operation(config, pinnedRequest),
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.data.items.length, 0, testCase.label);
        assert.equal(result.data.complete, false, testCase.label);
        assert.equal(result.data.truncatedReason, "INVALID_RECORDS", testCase.label);
      }
    }
  });

  it("marks broken tree responses as incomplete instead of empty checklist", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        body: {
          result: [sampleChecklistItem({ id: "900", parentId: "999", title: "Orphan" })],
          total: 1,
        },
      },
    });
    const result = await readBitrixChecklistForTask(config, "9001", {
      operation: operation(config, pinnedRequest),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.items.length, 0);
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "MISSING_PARENT");
    }
  });
});

