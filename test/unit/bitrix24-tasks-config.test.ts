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

  it("cannot bypass pilot allowlist without explicit working mode", () => {
    const config = loadBitrix24TasksRuntimeConfig({
      BITRIX24_TASKS_MODE: "pilot",
      BITRIX24_CACHE_PUBLISH_ENABLED: "true",
      BITRIX24_CACHE_ACCESS_TTL_MS: "3600000",
      BITRIX24_PILOT_ALLOWLIST_REQUIRED: "false",
      BITRIX24_PILOT_TASK_IDS: "9001,9002",
    });
    assert.equal(isPilotTaskFilterActive(config), true);
    assert.equal(isWorkingModeActive(config), false);
  });

  it("caps working discovery limits to bounded maximums", () => {
    const config = loadBitrix24TasksRuntimeConfig({
      BITRIX24_TASKS_MODE: "working",
      BITRIX24_CACHE_PUBLISH_ENABLED: "true",
      BITRIX24_CACHE_ACCESS_TTL_MS: "3600000",
      BITRIX24_WORKING_MAX_TASKS_PER_SYNC: "9999",
      BITRIX24_WORKING_MAX_DISCOVERY_PAGES: "9999",
      BITRIX24_WORKING_MAX_DISCOVERY_PAGES_TOTAL: "9999",
    });
    assert.equal(config.workingMaxTasksPerSync, 100);
    assert.equal(config.workingMaxDiscoveryPages, 50);
    assert.equal(config.workingMaxDiscoveryPagesTotal, 100);
  });
});
