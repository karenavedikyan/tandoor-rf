import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLabelsFromDescription } from "../../src/bitrix24/labels/parser";
import { formatLabelCode } from "../../src/bitrix24/labels/format";
import { buildTaskPortalUrl } from "../../src/bitrix24/tasks/portal-url";
import {
  fingerprintSourceContent,
  sourceContentFromSnapshot,
} from "../../src/bitrix24/tasks/snapshot-content";
import { buildSyncScopeSummary } from "../../src/bitrix24/tasks/repository";
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
      "42",
    );
    assert.equal(url, null);
  });

  it("rejects public portal url with rest path", () => {
    const url = buildTaskPortalUrl(
      "example.bitrix24.ru",
      "https://example.bitrix24.ru/rest/1/token",
      "1",
      "42",
    );
    assert.equal(url, null);
  });

  it("source fingerprint ignores published flag", () => {
    const base = {
      portalId: "p",
      taskId: "1",
      responsibleBitrixUserId: "42",
      title: "A",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: false,
      objectType: null,
      objectGuid: null,
      labelCode: null,
      bindingStatus: "unresolved",
      conflictReason: null,
      linkedAt: null,
    };
    const unpublished = fingerprintSourceContent(sourceContentFromSnapshot(base));
    const published = fingerprintSourceContent(
      sourceContentFromSnapshot({ ...base, published: true }),
    );
    assert.equal(unpublished, published);
  });

  it("detects source fingerprint change when title differs", () => {
    const base = {
      responsibleBitrixUserId: "42",
      title: "A",
      statusLabel: "in_progress",
      deadline: null,
      descriptionHash: "hash",
    };
    const first = fingerprintSourceContent(base);
    const second = fingerprintSourceContent({ ...base, title: "B" });
    assert.notEqual(first, second);
  });

  it("builds exact sync scope summary", () => {
    assert.equal(
      buildSyncScopeSummary("example.bitrix24.ru", "42"),
      "portal_id=example.bitrix24.ru;bitrix_user_id=42",
    );
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
