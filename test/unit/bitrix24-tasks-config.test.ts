import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPilotTaskFilterActive,
  isWorkingModeActive,
  loadBitrix24TasksRuntimeConfig,
} from "../../src/bitrix24/tasks/config";

describe("bitrix24 tasks config", () => {
  it("defaults to pilot mode", () => {
    const config = loadBitrix24TasksRuntimeConfig({
      BITRIX24_CACHE_PUBLISH_ENABLED: "true",
      BITRIX24_CACHE_ACCESS_TTL_MS: "3600000",
    });
    assert.equal(config.tasksMode, "pilot");
    assert.equal(isWorkingModeActive(config), false);
    assert.equal(isPilotTaskFilterActive(config), true);
  });

  it("requires cache publish for working mode", () => {
    const config = loadBitrix24TasksRuntimeConfig({
      BITRIX24_TASKS_MODE: "working",
      BITRIX24_CACHE_PUBLISH_ENABLED: "false",
      BITRIX24_CACHE_ACCESS_TTL_MS: "0",
    });
    assert.equal(config.tasksMode, "working");
    assert.equal(isWorkingModeActive(config), false);
  });

  it("activates working mode with explicit cache policy", () => {
    const config = loadBitrix24TasksRuntimeConfig({
      BITRIX24_TASKS_MODE: "working",
      BITRIX24_CACHE_PUBLISH_ENABLED: "true",
      BITRIX24_CACHE_ACCESS_TTL_MS: "3600000",
      BITRIX24_PILOT_ALLOWLIST_REQUIRED: "true",
    });
    assert.equal(isWorkingModeActive(config), true);
    assert.equal(isPilotTaskFilterActive(config), false);
  });
});
