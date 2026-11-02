import assert from "node:assert/strict";
import { it } from "node:test";
import { invitationTokenFromText, recipientBotLinks } from "../../src/tan-tracker/external-messenger/direct-invitation";
import { formatForwardableRecipientInvitation } from "../../src/tanbot/native-create/invitation-handoff";
import { buildReceiptEntryCallback, parseReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";

const token = `er${"a".repeat(43)}`;
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test", APP_ORIGIN: "https://lk.tandoor.ru", TT_EXTERNAL_MESSENGER_ENABLED: "true",
  TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
  TANBOT_TELEGRAM_BOT_TOKEN: "123456:synthetic-token-not-real-123456789",
  TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-secret-min16", TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-pepper-min16",
  TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_bot",
  TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
  TANBOT_MAX_BOT_TOKEN: "synthetic-max-token", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-secret-min16",
  TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-pepper-min16", TANBOT_MAX_BOT_USERNAME: "synthetic_bot",
};
const legacy = `https://lk.tandoor.ru/tan-tracker/recipient?mst=${token}`;

it("both direct bot links carry the same opaque token, no website, phone or OTP", () => {
  const links = recipientBotLinks(token, env);
  assert.equal(links.max, `https://max.ru/synthetic_bot?start=${token}`);
  assert.equal(links.telegram, `https://t.me/synthetic_bot?start=${token}`);
  const text = formatForwardableRecipientInvitation({
    publicCode: "TT-SYNTHETIC-1", senderName: "Sender", recipientName: "Recipient",
    item: "Item", portalUrl: legacy, botLinks: links,
  });
  assert.doesNotMatch(text, /lk\.tandoor|\/tan-tracker/);
  assert.match(text, /Сайт и вход в личный кабинет не нужны/);
  assert.deepEqual(invitationTokenFromText(text, env), { kind: "token", token });
});
it("unavailable or malformed channel configuration is not advertised", () => {
  assert.equal(recipientBotLinks(token, { ...env, TANBOT_MAX_ENABLED: "false" }).max, null);
  assert.equal(recipientBotLinks(token, { ...env, TANBOT_TELEGRAM_WEBHOOK_ENABLED: "false" }).telegram, null);
  assert.deepEqual(recipientBotLinks(token, { ...env, TT_EXTERNAL_MESSENGER_ENABLED: "false" }), { telegram: null, max: null });
  for (const base of ["https://attacker.test/bot", "http://max.ru/bot", "https://u:p@max.ru/bot", "https://max.ru:444/bot", "javascript:alert(1)"]) {
    assert.equal(recipientBotLinks(token, { ...env, TANBOT_MAX_BOT_PUBLIC_LINK: base }).max, null);
  }
  const links = recipientBotLinks(token, { ...env, TANBOT_MAX_BOT_PUBLIC_LINK: "https://max.ru/configured_bot?start=obsolete#fragment" });
  assert.equal(links.max, `https://max.ru/configured_bot?start=${token}`);
});
it("old website invitations are parsed locally including wrappers and punctuation", () => {
  for (const text of [legacy, `Старое приглашение:\n(${legacy}).`, `${legacy}\n${legacy}`]) {
    assert.deepEqual(invitationTokenFromText(text, env), { kind: "token", token });
  }
  assert.deepEqual(invitationTokenFromText(legacy.replace("lk.tandoor.ru", "karenavedikyan-tandoor-rf-24e1.twc1.net"), env), { kind: "token", token });
});
it("malformed or ambiguous invitations cannot select a transfer or become draft text", () => {
  for (const text of [
    `${legacy}&mst=${token}`, `${legacy}&mst=`, legacy.replace(token, "er-short"),
    `${legacy}\n${legacy.replace(token, `er${"b".repeat(43)}`)}`,
  ]) assert.deepEqual(invitationTokenFromText(text, env), { kind: "invalid" });
});
it("foreign origins, paths, credentials, fragments and unrelated text are not invitation credentials", () => {
  for (const text of [
    legacy.replace("lk.tandoor.ru", "lk.tandoor.ru.attacker.test"), legacy.replace("lk.tandoor.ru", "attacker.test"),
    legacy.replace("/tan-tracker/recipient", "/another"), legacy.replace("https://", "https://user:pass@"),
    `${legacy}#fragment`, "Мои передачи", "345678", `TT-${token}`,
  ]) assert.deepEqual(invitationTokenFromText(text, env), { kind: "none" });
});
it("refresh callback is bounded and retains exact transfer and version", () => {
  const value = buildReceiptEntryCallback("invite", "TT-2026-123", 4);
  assert.ok(value && Buffer.byteLength(value) <= 64);
  assert.deepEqual(parseReceiptEntryCallback(value), { action: "invite", transferId: "TT-2026-123", version: 4 });
  assert.equal(parseReceiptEntryCallback(value.replace(":4", ":0")), null);
});
