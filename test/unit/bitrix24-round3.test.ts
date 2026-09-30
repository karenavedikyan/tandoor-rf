import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLabelsFromDescription } from "../../src/bitrix24/labels/parser";
import { formatLabelCode } from "../../src/bitrix24/labels/format";
import { buildTaskPortalUrl } from "../../src/bitrix24/tasks/portal-url";
import {
  fingerprintBindingContent,
  fingerprintCacheContent,
} from "../../src/bitrix24/tasks/snapshot-content";
import {
  BITRIX24_SYNC_MAX_MAX_PAGES,
  parseBitrix24SyncCliArgs,
} from "../../src/bitrix24/sync-cli-args";

describe("bitrix24 round3", () => {
  it("extracts label from HTML paragraph lines", () => {
    const parsed = extractLabelsFromDescription("<p>#LK_H_000001</p><p>Описание</p>");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels[0]?.labelCode, "LK_H_000001");
    }
  });

  it("extracts label from br-separated description", () => {
    const parsed = extractLabelsFromDescription("#LK_H_000001<br>Описание");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.labels.length, 1);
    }
  });

  it("rejects public portal url with mismatched port", () => {
    const url = buildTaskPortalUrl(
      "example.bitrix24.ru",
      "https://example.bitrix24.ru:8443",
      "1",
    );
    assert.equal(url, null);
  });

  it("rejects public portal url with rest path", () => {
    const url = buildTaskPortalUrl(
      "example.bitrix24.ru",
      "https://example.bitrix24.ru/rest/1/token",
      "1",
    );
    assert.equal(url, null);
  });

  it("detects cache fingerprint change when title differs", () => {
    const base = {
      responsibleBitrixUserId: "42",
      title: "A",
      statusLabel: "in_progress",
      deadline: null,
      descriptionHash: "hash",
      published: true,
    };
    const first = fingerprintCacheContent(base);
    const second = fingerprintCacheContent({ ...base, title: "B" });
    assert.notEqual(first, second);
  });

  it("includes audience in binding fingerprint", () => {
    const first = fingerprintBindingContent({
      objectType: "holding",
      objectGuid: "11111111-1111-4111-8111-111111111111",
      labelCode: "LK_H_000001",
      bindingStatus: "confirmed",
      conflictReason: null,
      responsibleBitrixUserId: "42",
    });
    const second = fingerprintBindingContent({
      objectType: "holding",
      objectGuid: "11111111-1111-4111-8111-111111111111",
      labelCode: "LK_H_000001",
      bindingStatus: "confirmed",
      conflictReason: null,
      responsibleBitrixUserId: "99",
    });
    assert.notEqual(first, second);
  });

  it("allows label code 999999 at format layer", () => {
    assert.equal(formatLabelCode("holding", 999999), "LK_H_999999");
  });

  it("validates sync CLI max-pages bounds", () => {
    const invalid = parseBitrix24SyncCliArgs([
      "--bitrix-user-id",
      "42",
      "--max-pages",
      String(BITRIX24_SYNC_MAX_MAX_PAGES + 1),
    ]);
    assert.equal(invalid.ok, false);
  });
});
