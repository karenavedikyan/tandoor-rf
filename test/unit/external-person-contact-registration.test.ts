import assert from "node:assert/strict";
import { it } from "node:test";
import type { PoolClient } from "pg";
import { registerVerifiedBotContact } from "../../src/tanbot/external-person/verified-contact-registration";
import { EmployeePhoneCollisionError } from "../../src/tan-tracker/phone-party-resolver";

const input = {
  channel: "telegram" as const, messengerUserId: 123n, messengerChatId: 123n,
  phoneRaw: "+79990001122", displayName: "Synthetic contact",
};
const rejectingClient = (error: unknown) => ({
  query: async () => { throw error; },
}) as unknown as PoolClient;

for (const http of [400, 403, 409]) {
  it(`explains expected registration rejection ${http} without treating it as verification`, async () => {
    const result = await registerVerifiedBotContact(
      rejectingClient(Object.assign(new Error("Synthetic rejection"), { http })), input,
    );
    assert.deepEqual(result, { ok: false, text: "Не удалось подтвердить номер.\n\nSynthetic rejection" });
  });
}

it("does not swallow unexpected errors or expose database details as chat text", async () => {
  for (const error of [new Error("database offline"), Object.assign(new Error("server"), { http: 500 }),
    Object.assign(new Error("unexpected string status"), { http: "403" }),
    { message: "untrusted object", http: 403 }]) {
    await assert.rejects(registerVerifiedBotContact(rejectingClient(error), input),
      thrown => thrown === error);
  }
});

for (const channel of ["max", "telegram"] as const) {
  it(`${channel}: employee contact leads to secure LK linking, not another contact request`, async () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://synthetic.test";
    try {
      const result = await registerVerifiedBotContact(rejectingClient(new EmployeePhoneCollisionError()),
        { ...input, channel });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.requestContact, false);
      assert.equal(result.profileUrl, "https://synthetic.test/profile");
      assert.match(result.text, /и в личном кабинете, и в/);
      assert.match(result.text, new RegExp(`Подключить ${channel === "max" ? "MAX" : "Telegram"}`));
      assert.match(result.text, /Созданные ранее передачи сохранятся/);
      assert.doesNotMatch(result.text, /Не удалось подтвердить номер|Используйте личный кабинет/);
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previousOrigin;
    }
  });
}
