import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadNightlyExchangeConfig } from "../../src/onec-nightly-exchange/config";

describe("nightly exchange config", () => {
  it("defaults to disabled without requiring schedule fields", () => {
    const loaded = loadNightlyExchangeConfig({});
    assert.deepEqual(loaded, { ok: true, enabled: false });
  });

  it("requires valid time and window when enabled", () => {
    assert.deepEqual(loadNightlyExchangeConfig({ ONEC_NIGHTLY_EXCHANGE_ENABLED: "true" }), {
      ok: false,
      error: "ONEC_NIGHTLY_EXCHANGE_TIME is required when ONEC_NIGHTLY_EXCHANGE_ENABLED=true.",
    });

    const invalidTime = loadNightlyExchangeConfig({
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
      ONEC_NIGHTLY_EXCHANGE_TIME: "25:99",
      ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: "60",
    });
    assert.equal(invalidTime.ok, false);
    if (!invalidTime.ok) {
      assert.match(invalidTime.error, /Invalid ONEC_NIGHTLY_EXCHANGE_TIME/);
    }

    const missingWindow = loadNightlyExchangeConfig({
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
      ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
    });
    assert.equal(missingWindow.ok, false);
    if (!missingWindow.ok) {
      assert.match(missingWindow.error, /ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES is required/);
    }

    const invalidWindow = loadNightlyExchangeConfig({
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
      ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
      ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: "0",
    });
    assert.equal(invalidWindow.ok, false);
    if (!invalidWindow.ok) {
      assert.match(invalidWindow.error, /Invalid ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES/);
    }
  });

  it("accepts explicit valid schedule when enabled", () => {
    const loaded = loadNightlyExchangeConfig({
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
      ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
      ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: "60",
    });
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.enabled) {
      assert.equal(loaded.config.scheduleTime, "02:30");
      assert.equal(loaded.config.windowMinutes, 60);
    }
  });

  it("rejects loose parseInt window values when enabled", () => {
    for (const windowMinutes of ["60abc", "1.5", "1e2"]) {
      const loaded = loadNightlyExchangeConfig({
        ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
        ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
        ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: windowMinutes,
      });
      assert.equal(loaded.ok, false, `expected config_error for ${windowMinutes}`);
      if (!loaded.ok) {
        assert.match(loaded.error, /Invalid ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES/);
      }
    }
  });

  it("accepts window minute boundaries 1 and 180 when enabled", () => {
    for (const [windowMinutes, expected] of [
      ["1", 1],
      ["180", 180],
    ] as const) {
      const loaded = loadNightlyExchangeConfig({
        ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
        ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
        ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: windowMinutes,
      });
      assert.equal(loaded.ok, true, `expected ok for ${windowMinutes}`);
      if (loaded.ok && loaded.enabled) {
        assert.equal(loaded.config.windowMinutes, expected);
      }
    }
  });

  it("rejects window minutes 0 and 181 when enabled", () => {
    for (const windowMinutes of ["0", "181"]) {
      const loaded = loadNightlyExchangeConfig({
        ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
        ONEC_NIGHTLY_EXCHANGE_TIME: "02:30",
        ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: windowMinutes,
      });
      assert.equal(loaded.ok, false, `expected config_error for ${windowMinutes}`);
      if (!loaded.ok) {
        assert.match(loaded.error, /Invalid ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES/);
      }
    }
  });
});
