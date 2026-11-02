import assert from "node:assert/strict";
import { it } from "node:test";
import { holderTransferActionButtons } from "../../src/tanbot/native-create/holder-transfer-buttons";
import { parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";

const row = {
  id: "TT-2026-999", status: "delivered", holder_party_id: "holder", pending_party_id: null,
  final_recipient_party_id: "holder", handoff_version: 7, allow_legacy_complete: false,
};

it("shared holder buttons use canonical actions, transfer identity and current handoff version", () => {
  const buttons = holderTransferActionButtons(row, "holder");
  assert.deepEqual(buttons.map(b => b.text), ["Передать дальше", "Завершить трек"]);
  assert.deepEqual(buttons.map(b => parseReceiptEntryCallback(b.data)), [
    { action: "forward", transferId: row.id, version: 7 },
    { action: "close", transferId: row.id, version: 7 },
  ]);
});
it("intermediate holders can forward but cannot complete except through the existing legacy permission", () => {
  const intermediate = { ...row, final_recipient_party_id: "another" };
  assert.deepEqual(holderTransferActionButtons(intermediate, "holder").map(b => b.text), ["Передать дальше"]);
  assert.equal(holderTransferActionButtons({ ...intermediate, allow_legacy_complete: true }, "holder").length, 2);
  assert.equal(holderTransferActionButtons({ ...row, final_recipient_party_id: null }, "holder").length, 2);
});
it("non-holders and missing identities get no mutation buttons", () => {
  assert.deepEqual(holderTransferActionButtons(row, null), []);
  assert.deepEqual(holderTransferActionButtons(row, "observer"), []);
});
it("pending, terminal, archived, deleted and unknown states have no forward/completion buttons", () => {
  for (const change of [
    { pending_party_id: "next" }, { status: "completed" }, { status: "obsolete" },
    { status: "unknown" }, { general_archived_at: new Date() }, { deleted_at: new Date() },
  ]) assert.deepEqual(holderTransferActionButtons({ ...row, ...change }, "holder"), []);
});
it("active/open states without pending recipient preserve the existing holder actions", () => {
  for (const status of ["active", "waiting", "delivered"]) {
    assert.equal(holderTransferActionButtons({ ...row, status }, "holder").length, 2);
  }
});
it("invalid callbacks are not exposed as broken buttons", () => {
  assert.deepEqual(holderTransferActionButtons({ ...row, id: "invalid id" }, "holder"), []);
  assert.deepEqual(holderTransferActionButtons({ ...row, handoff_version: 0 }, "holder"), []);
});
