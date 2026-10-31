import test from "node:test";
import assert from "node:assert/strict";
import { startBrowserHttpFixture, stopBrowserHttpFixture } from "../browser/helpers/http-integration-browser";
import { buildExternalPersonMessengerBody } from "../../src/tan-tracker/external-person/messenger-copy";
import { buildMaxExternalPersonOutboxPresentation } from "../../src/tan-tracker/external-person/max-outbox-presentation";
import { createDefaultMaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";

test("independent: public OG/image and actual MAX HTTP payload, without external send", async () => {
  const fixture = await startBrowserHttpFixture({ attachmentsDir: "var/message-preview-review" });
  try {
    for (const path of ["/tan-tracker/", "/tan-tracker/recipient"]) {
      const response = await fetch(
        `${fixture.baseUrl}${path}?cap=NEVER_ECHO_CAP&tt_hat=NEVER_ECHO_HAT&est=NEVER_ECHO_EST`,
        { headers: { "User-Agent": "Synthetic-MAX-preview-crawler" } },
      );
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /property="og:title" content="Тандор · Передачи под контролем"/);
      assert.match(html, /property="og:image" content="https:\/\/lk.tandoor.ru\/brand\/tandoor-tracker-preview-v1.png"/);
      assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
      assert.equal(html.includes("NEVER_ECHO"), false);
      assert.equal(/property="og:url"|rel="canonical"/.test(html), false);
      assert.equal((html.match(/property="og:title"/g) || []).length, 1);
    }
    const image = await fetch(`${fixture.baseUrl}/brand/tandoor-tracker-preview-v1.png`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") || "", /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);

    const personalUrl = "https://lk.tandoor.ru/tan-tracker/?cap=SYNTHETIC_CAP&tt_hat=SYNTHETIC_HAT";
    const stored = buildExternalPersonMessengerBody({
      event: "delivered", itemTitle: "Synthetic parcel", publicCode: "TEST-001", holderUrl: personalUrl,
      notificationState: { phase: "received", holderName: "Synthetic recipient" },
    });
    const presentation = buildMaxExternalPersonOutboxPresentation(stored, "https://lk.tandoor.ru");
    assert.equal(presentation.mode, "rich");
    if (presentation.mode !== "rich") return;
    assert.match(presentation.text, /Вы получили «Synthetic parcel»/);
    assert.match(presentation.text, /Статус: Получение подтверждено\nОтветственный: Synthetic recipient/);
    assert.match(presentation.text, /посмотреть историю, передать предмет дальше или вернуть отправителю/);
    assert.equal(/https?:|SYNTHETIC_CAP|SYNTHETIC_HAT/.test(presentation.text), false);
    let captured: { url: string; body: any } | null = null;
    const mockFetch = async (url: any, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ message: { mid: "synthetic-message" } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    const transport = createDefaultMaxDeliveryTransport(mockFetch as typeof fetch);
    const result = await transport({
      token: "SYNTHETIC_NOT_A_SECRET_TOKEN", userId: 991122n,
      text: presentation.text, shareUrl: presentation.shareUrl, inlineButtons: presentation.inlineButtons,
      timeoutMs: 1000, maxResponseBytes: 8192,
    });
    assert.equal(result.ok, true);
    assert.ok(captured);
    const wire = captured as { url: string; body: any };
    assert.match(wire.url, /\/messages\?user_id=991122$/);
    assert.equal(wire.body.text, presentation.text);
    const share = wire.body.attachments.filter((x: any) => x.type === "share");
    const keyboard = wire.body.attachments.filter((x: any) => x.type === "inline_keyboard");
    assert.equal(share.length, 1);
    assert.deepEqual(share[0].payload, { url: personalUrl });
    assert.equal(keyboard.length, 1);
    assert.deepEqual(keyboard[0].payload.buttons, [[{
      type: "link", text: "Открыть передачу", url: personalUrl,
    }]]);
  } finally { await stopBrowserHttpFixture(fixture); }
});

test("independent: empty holder URL must preserve the existing shell-link fallback", () => {
  const shell = "https://lk.tandoor.ru/tan-tracker/?cap=SYNTHETIC_SHELL";
  const body = buildExternalPersonMessengerBody({
    event: "delivered", itemTitle: "Synthetic parcel", publicCode: "TEST-002", holderUrl: "", shellUrl: shell,
  });
  assert.ok(body.endsWith(`Открыть: ${shell}`));
});
