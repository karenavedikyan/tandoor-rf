import assert from "node:assert/strict";
import { it } from "node:test";
import { buildTrackStatusCallback, parseTrackStatusCallback, parseTrackStatusText } from "../../src/tanbot/track-status-callback";
import { formatTrackStatus, formatTrackStatusListLabel } from "../../src/tanbot/native-create/track-status";
import { isNativeCreateCallback } from "../../src/tanbot/native-create/engine";
import { parseNativeCreateCallback, buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../../src/tanbot/native-create/menu-sentinel";
import type { PoolClient } from "pg";
import type { AccessContext } from "../../src/access/types";
import { loadTanTrackerTeamEmployeeGuids } from "../../src/tan-tracker/team-scope";

it("read callbacks roundtrip within provider limits and are routable without a draft", () => {
  for (const request of [{ action: "list", page: 0 }, { action: "list", page: 99999 },
    { action: "view", transferId: "TT-2026-123" }, { action: "view", transferId: "74dde016-cf55-44e6-bcdc-aacdaf9fe3ab" },
    { action: "view", transferId: "TT-2026-123", archivePage: 0 },
    { action: "view", transferId: "74dde016-cf55-44e6-bcdc-aacdaf9fe3ab", archivePage: 99999 }] as const) {
    const callback = buildTrackStatusCallback(request)!;
    assert.ok(Buffer.byteLength(callback) <= 64);
    assert.deepEqual(parseTrackStatusCallback(callback), request);
    assert.equal(isNativeCreateCallback(callback), true);
  }
  const menu = buildNativeCreateCallback("menu_status", NATIVE_MENU_DRAFT_HEX, 1)!;
  assert.equal(parseNativeCreateCallback(menu)?.action, "menu_status");
});
it("rejects malformed, noncanonical or oversized callbacks", () => {
  for (const value of ["ts:l:-1", "ts:l:00", "ts:l:100000", "ts:v:", "ts:v:!!!!", "ts:v:VFE=", "ts:v:YQ==",
    `ts:v:${"YQ".repeat(40)}`, "ts:close:1", "he:pick:VFE:1", "ts:a:00:VFE", "ts:a:-1:VFE", "ts:a:100000:VFE",
    "ts:a:0:YQ==", "ts:a:0:!!!!", `ts:a:0:${"YQ".repeat(40)}`]) assert.equal(parseTrackStatusCallback(value), null, value);
  assert.equal(buildTrackStatusCallback({ action: "list", page: -1 }), null);
  assert.equal(buildTrackStatusCallback({ action: "view", transferId: "../other" }), null);
  for (const archivePage of [-1, 100000, 1.5, NaN, Infinity]) {
    assert.equal(buildTrackStatusCallback({ action: "view", transferId: "TT-2026-123", archivePage }), null);
  }
});
it("archive view keeps a separate bounded return page without changing old status callback format", () => {
  const regular = buildTrackStatusCallback({ action: "view", transferId: "TT-2026-123" })!;
  assert.equal(regular, `ts:v:${Buffer.from("TT-2026-123").toString("base64url")}`);
  const archived = buildTrackStatusCallback({ action: "view", transferId: "TT-2026-123", archivePage: 3 })!;
  assert.notEqual(archived, regular);
  assert.deepEqual(parseTrackStatusCallback(archived), { action: "view", transferId: "TT-2026-123", archivePage: 3 });
});
it("status text search is exact and never treats arbitrary draft text as navigation", () => {
  assert.deepEqual(parseTrackStatusText("Статус трека"), {});
  assert.deepEqual(parseTrackStatusText("Статус tt-2026-123"), { transferId: "TT-2026-123" });
  assert.deepEqual(parseTrackStatusText("Статус трека TT-2026-024"), { transferId: "TT-2026-024" });
  for (const value of ["Статус", "Статус получателя", "TT-2026-123", "Статус TT-2026-123 tail", "345678"]) {
    assert.equal(parseTrackStatusText(value), null);
  }
});
it("waiting card distinguishes current holder from pending recipient, without OTP or phone fields", () => {
  const text = formatTrackStatus({ public_code: "TT-2026-123", item_title: "Synthetic parcel" },
    { phase: "waiting", holderName: "Current holder", pendingName: "Expected recipient" }, new Date("2026-11-02T13:00:00Z"));
  assert.match(text, /Текущий держатель: Current holder/);
  assert.match(text, /Следующий получатель: Expected recipient/);
  assert.match(text, /Пока код не подтверждён/);
  assert.match(text, /16:00:00 МСК/);
  assert.doesNotMatch(text, /Телефон|OTP|Контакт/);
});
it("completed/archive cards do not claim a new handoff or an active track", () => {
  const text = formatTrackStatus({ public_code: "TT-2026-123", item_title: "Synthetic", general_archived_at: new Date() },
    { phase: "done", holderName: "Last holder" });
  assert.match(text, /Статус: Завершён/);
  assert.match(text, /Последний держатель: Last holder/);
  assert.match(text, /в общем архиве/);
  assert.doesNotMatch(text, /Трек открыт|Следующий получатель/);
});
it("status list shows the holder for every open state without presenting pending receipt as custody", () => {
  for (const status of ["waiting", "active", "delivered"] as const) {
    assert.equal(formatTrackStatusListLabel({ public_code: "TT-2026-123", status }, "Иван Петров"),
      "TT-2026-123 · Иван Петров");
  }
});
it("status list marks completed and obsolete distinctly while retaining the last holder", () => {
  assert.equal(formatTrackStatusListLabel({ public_code: "TT-2026-123", status: "completed" }, "Иван Петров"),
    "TT-2026-123 · Иван Петров · Завершён");
  assert.equal(formatTrackStatusListLabel({ public_code: "TT-2026-124", status: "obsolete" }, "Иван Петров"),
    "TT-2026-124 · Иван Петров · Неактуален");
});
it("status list cleans names and substitutes missing or contact-only identities instead of exposing them", () => {
  const row = { public_code: "TT-2026-123", status: "active" as const };
  for (const name of [null, undefined, "", " \n\u0000 ", "+79991234567", "holder@example.test"]) {
    assert.equal(formatTrackStatusListLabel(row, name), "TT-2026-123 · Имя не указано");
  }
  assert.equal(formatTrackStatusListLabel(row, "\u0000 Иван\n Петров\t"), "TT-2026-123 · Иван Петров");
});
it("status list bounds visible identifiers and names without truncating the terminal label", () => {
  assert.equal(formatTrackStatusListLabel({ public_code: "T".repeat(50), status: "obsolete" }, "Я".repeat(100)),
    `${"T".repeat(30)} · ${"Я".repeat(40)} · Неактуален`);
});
for (const role of ["rop", "regional_manager"] as const) {
  it(`${role} reuses the supplied connection for every team query without a nested pool acquisition`, async () => {
    const calls: string[] = [];
    const client = { async query(sql: string) {
      calls.push(sql);
      return { rows: sql.includes("FROM rop_team_members")
        ? [{ employee_guid: "leader" }, { employee_guid: "legacy-member" }]
        : [{ employee_guid: "leader" }, { employee_guid: "onec-member" }] };
    } } as unknown as PoolClient;
    const team = await loadTanTrackerTeamEmployeeGuids({
      userId: "de1b6dcb-4075-4abe-844e-dafac7be8c2b", employeeId: "leader", role,
    } as AccessContext, client);
    assert.deepEqual([...team!].sort(), (role === "rop"
      ? ["leader", "legacy-member", "onec-member"] : ["leader", "onec-member"]).sort());
    assert.equal(calls.length, role === "rop" ? 2 : 1);
  });
}
