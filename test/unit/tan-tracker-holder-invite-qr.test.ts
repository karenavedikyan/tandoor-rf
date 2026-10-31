import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");
function functionText(name: string) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}
function inviteFixture(overrides: Record<string, unknown> = {}) {
  const context: Record<string, unknown> = {
    TT_LK: true, actorContactId: () => "holder", isPublicHolderSession: () => true,
    lkMutationAllowed: () => false, externalMessengerUiEnabled: () => false,
    pendingContactIsExternal: () => false,
    absoluteHandoffUrl: (url: string) => url,
    handoffUrl: () => "https://example.test/tan-tracker/recipient#tt_tok=recipient-only",
    ...overrides,
  };
  const getUrl = vm.runInNewContext(`(${functionText("recipientCodeInvitationUrl")})`, context);
  const order = {
    id: "TT-TEST-1", holderId: "holder", pendingId: "receiver", handoffVer: 3,
    activeInvitation: { id: "TT-TEST-1", holderId: "holder", pendingId: "receiver", hv: 3, invitationToken: "recipient-only" },
  };
  return { getUrl, order };
}
describe("holder recipient invitation and QR", () => {
  it("external current holder can share the signed recipient link without cabinet write access", () => {
    const { getUrl, order } = inviteFixture();
    assert.match(getUrl(order), /tt_tok=recipient-only/);
    assert.doesNotMatch(getUrl(order), /tt_hat|holderAccessToken|est=/);
  });
  it("does not expose invitation actions to former holder or read-only cabinet observer", () => {
    const { getUrl, order } = inviteFixture();
    assert.equal(getUrl({ ...order, holderId: "someone-else" }), "");
    assert.equal(inviteFixture({ isPublicHolderSession: () => false }).getUrl(order), "");
  });
  it("requires an active signed invitation matching transfer, pending recipient, holder and handoff version", () => {
    const { getUrl, order } = inviteFixture();
    for (const patch of [{ id: "other" }, { pendingId: "other" }, { holderId: "other" }, { hv: 2 }, { invitationToken: "" }]) {
      assert.equal(getUrl({ ...order, activeInvitation: { ...order.activeInvitation, ...patch } }), "");
    }
    assert.equal(getUrl({ ...order, pendingId: null }), "");
    assert.equal(getUrl({ ...order, activeInvitation: null }), "");
  });
  it("preserves the existing authenticated external-recipient messenger invite path", () => {
    const { getUrl, order } = inviteFixture({
      isPublicHolderSession: () => false, lkMutationAllowed: () => true,
      externalMessengerUiEnabled: () => true, pendingContactIsExternal: () => true,
    });
    assert.equal(getUrl(order), "");
  });
  it("public holder can also invite an external recipient when messenger integration is enabled", () => {
    const { getUrl, order } = inviteFixture({
      externalMessengerUiEnabled: () => true, pendingContactIsExternal: () => true,
    });
    assert.match(getUrl(order), /tt_tok=recipient-only/);
  });
  it("invitation text includes sender, recipient, item, track and code instructions", () => {
    const text = vm.runInNewContext(`(${functionText("messengerInvitationMessagePlain")})`, {
      contactById: (id: string) => ({ name: id === "holder" ? "Отправитель" : "Получатель" }),
      absoluteHandoffUrl: (url: string) => url,
    })({ id: "TT-TEST-1", holderId: "holder", pendingId: "receiver", item: "Посылка" }, "https://example.test/invite");
    for (const expected of ["Отправитель: Отправитель", "Получатель: Получатель", "Предмет: Посылка", "Трек: TT-TEST-1", "получите код приёма", "Сообщите этот код отправителю", "https://example.test/invite"]) {
      assert.ok(text.includes(expected), expected);
    }
  });
  it("uses a raster image with explicit dimensions instead of scalable inline SVG", () => {
    const fn = vm.runInNewContext(`(${functionText("qrImageHtml")})`, {
      E: (text: string) => text,
      qrcode: () => ({ addData() {}, make() {}, getModuleCount: () => 21, createDataURL: () => "data:image/gif;base64,R0lG" }),
    });
    assert.match(fn("recipient link"), /<img.*data:image\/gif/);
    assert.match(fn("recipient link"), /width="\d+" height="\d+" alt=/);
    assert.doesNotMatch(fn("recipient link"), /<svg/);
  });
  it("missing generator yields no blank markup; painter provides a readable fallback", () => {
    assert.equal(vm.runInNewContext(`(${functionText("qrImageHtml")})`, {})("link"), "");
    const painter = functionText("paintQrHosts");
    assert.match(painter, /Не удалось показать QR-код/);
    assert.match(painter, /addEventListener\("error", fail/);
    assert.match(painter, /catch/);
  });
});
