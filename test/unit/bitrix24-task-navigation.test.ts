import assert from "node:assert/strict";
import { it } from "node:test";
import { buildTaskPortalUrl } from "../../src/bitrix24/tasks/portal-url";

it("uses the actual Bitrix personal user task route", () => {
  assert.equal(
    buildTaskPortalUrl("example.bitrix24.ru", "https://example.bitrix24.ru", "1041697", "2"),
    "https://example.bitrix24.ru/company/personal/user/2/tasks/task/view/1041697/",
  );
});

it("never generates a task link without canonical task and responsible IDs", () => {
  for (const bad of [undefined, "", "0", "01", "-2", "../2", "1?token=secret"]) {
    assert.equal(buildTaskPortalUrl("example.bitrix24.ru", "https://example.bitrix24.ru", "10", bad), null);
    if (bad !== undefined) {
      assert.equal(buildTaskPortalUrl("example.bitrix24.ru", "https://example.bitrix24.ru", bad, "2"), null);
    }
  }
});

it("rejects foreign origins and credential URLs", () => {
  for (const url of ["https://evil.example", "http://example.bitrix24.ru", "https://example.bitrix24.ru/rest/2/secret", "https://user:pass@example.bitrix24.ru"]) {
    assert.equal(buildTaskPortalUrl("example.bitrix24.ru", url, "10", "2"), null);
  }
});
