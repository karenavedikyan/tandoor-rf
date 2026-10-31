import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

type Ui = {
  externalActionBarHtml(): string;
  externalShellHomeHtml(): string;
  externalHolderDetailBlocks(order: Record<string, unknown>, actor: string): string;
};

function fixture(view: string, rows: Record<string, unknown>[] = []) {
  const state = { view, actingContactId: "holder", orderId: "TT-TEST-1" };
  const window: Record<string, unknown> = {
    TanTrackerPrototype: {
      state,
      contacts: () => [{ id: "holder", name: "Получатель", phone: "+79991234002" }],
      orders: () => rows,
      canViewOrder: () => true,
    },
  };
  const context = vm.createContext({ window, document: { addEventListener() {} } });
  vm.runInContext(readFileSync(path.join(process.cwd(), "public/tan-tracker-external-ui.js"), "utf8"), context);
  return { ui: window.TtExternalUi as Ui, state };
}

describe("external new-item and existing-item actions", () => {
  it("keeps list routing and external-person selection independent of a remembered/first order", () => {
    const source = readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");
    assert.match(source, /if \(isExternalShell\(\) && o && state\.view !== "list"\) return detailView\(o\)/);
    assert.match(source, /if \(data\.publicHolder && !data\.externalPerson\) state\.orderId = data\.orders\?\.\[0\]\?\.id/);
  });
  it("only the list offers clearly labelled creation of a separate track", () => {
    const { ui } = fixture("list");
    const html = ui.externalActionBarHtml();
    assert.match(html, /Создать новую передачу/);
    assert.match(html, /Для другого предмета будет создан отдельный трек/);
    assert.equal((html.match(/data-tt="ext-request-open"/g) || []).length, 1);
    assert.doesNotMatch(html, /Отправить предмет/);
  });

  for (const view of ["detail", "transfer", "code", "ext-request", "public-holder", "handoff-receipt"]) {
    it(`${view} never offers a new-item action above the current task`, () => {
      const { ui } = fixture(view);
      const html = ui.externalActionBarHtml();
      assert.match(html, /tt-ext-bar--compact/);
      assert.doesNotMatch(html, /ext-request-open|Создать новую передачу|Отправить предмет/);
    });
  }

  it("delivered current holder gets a primary action explicitly preserving the same track", () => {
    const { ui } = fixture("detail");
    const html = ui.externalHolderDetailBlocks({
      id: "TT-TEST-1", holderId: "holder", finalRecipientId: "holder",
      status: "delivered", holderSince: Date.now(), timeline: [],
    }, "holder");
    assert.match(html, /Передать этот предмет дальше/);
    assert.match(html, /class="tt-primary tt-btn-block" data-tt="transfer"/);
    assert.match(html, /продолжение трека TT-TEST-1, а не новая передача/);
    assert.doesNotMatch(html, /Делать ничего не нужно|ext-request-open/);
  });

  it("relay holder sees same-track forwarding, but former holder sees no action", () => {
    const { ui } = fixture("detail");
    const order = { id: "TT-TEST-2", holderId: "holder", finalRecipientId: "next", status: "in_transit" };
    assert.match(ui.externalHolderDetailBlocks(order, "holder"), /Продолжение трека TT-TEST-2/);
    assert.equal(ui.externalHolderDetailBlocks(order, "former"), "");
  });

  it("completed tracks do not offer forwarding", () => {
    const { ui } = fixture("detail");
    const html = ui.externalHolderDetailBlocks({
      id: "TT-TEST-3", holderId: "holder", finalRecipientId: "holder", status: "completed",
    }, "holder");
    assert.match(html, /Передача завершена/);
    assert.doesNotMatch(html, /data-tt="transfer"|ext-request-open/);
  });

  it("groups received items as items with you, while keeping pending actions separate", () => {
    const { ui } = fixture("list", [
      { id: "HELD", item: "Полученный предмет", holderId: "holder", status: "delivered" },
      { id: "INCOMING", item: "Входящий предмет", holderId: "sender", pendingId: "holder", status: "waiting" },
      { id: "PENDING", item: "Ожидает кода", holderId: "holder", pendingId: "next", status: "waiting" },
    ]);
    const html = ui.externalShellHomeHtml();
    const held = html.match(/<section[^>]*data-tt-ext-group="held"[\s\S]*?<\/section>/)?.[0];
    assert.ok(held);
    assert.match(held, /Предметы у вас/);
    assert.match(held, /Полученный предмет/);
    assert.doesNotMatch(held, /Входящий предмет|Ожидает кода/);
    assert.match(html, /Требуют вашего действия/);
  });
});
