import assert from "node:assert/strict";
import { it } from "node:test";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { createOperationContext } from "../../src/bitrix24/transport";
import { parseBitrix24SyncCliArgs } from "../../src/bitrix24/sync-cli-args";
import { createBitrixMockPinnedRequest, createSafePortalResolver, sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";

async function read(tasks: unknown[], total = tasks.length, next?: number, taskId = "10") {
  const config = sampleWebhookConfig();
  const mock = createBitrixMockPinnedRequest({
    [`${config.webhookBaseUrl}tasks.task.list`]: { body: { result: { tasks }, total, ...(next === undefined ? {} : { next }) } },
  });
  const operation = createOperationContext(config);
  operation.pinnedRequest = mock.pinnedRequest;
  operation.resolvePortalAddresses = createSafePortalResolver();
  return { result: await readBitrixTasksForUser(config, "42", { operation, taskId }), calls: mock.calls };
}

it("pilot sends both ID and responsible filters and reads one task", async () => {
  const { result, calls } = await read([sampleValidBitrixTask()]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.complete, true);
    assert.equal(result.data.tasks.length, 1);
  }
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0].body as { filter: unknown }).filter, { RESPONSIBLE_ID: "42", ID: "10" });
});

for (const [name, tasks, total, next] of [
  ["wrong task", [sampleValidBitrixTask({ ID: "11" })], 1, undefined],
  ["wrong employee", [sampleValidBitrixTask({ RESPONSIBLE_ID: "43" })], 1, undefined],
  ["invalid record", [{}], 1, undefined],
  ["multiple tasks", [sampleValidBitrixTask(), sampleValidBitrixTask({ ID: "11" })], 2, undefined],
  ["extra total", [sampleValidBitrixTask()], 2, undefined],
  ["pagination", [sampleValidBitrixTask()], 1, 50],
] as const) {
  it(`pilot fails closed on ${name}`, async () => {
    const { result, calls } = await read([...tasks], total, next);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PILOT_SCOPE_MISMATCH");
    assert.equal(calls.length, 1);
  });
}

it("invalid pilot IDs cause no requests", async () => {
  for (const id of ["", "0", "01", "-1", "1e2", "10,11"]) {
    const { result, calls } = await read([], 0, undefined, id);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
    assert.equal(parseBitrix24SyncCliArgs(["--bitrix-user-id", "42", "--task-id", id]).ok, false);
  }
});

it("CLI preserves scoped ID and rejects duplicate or missing ID", () => {
  const parsed = parseBitrix24SyncCliArgs(["--bitrix-user-id", "42", "--task-id", "10", "--apply"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.options.taskId, "10");
  assert.equal(parseBitrix24SyncCliArgs(["--bitrix-user-id", "42", "--task-id"]).ok, false);
  assert.equal(parseBitrix24SyncCliArgs(["--bitrix-user-id", "42", "--task-id", "10", "--task-id", "11"]).ok, false);
});
