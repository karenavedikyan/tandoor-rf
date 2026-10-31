import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { createMaxCommandInstallTransport, createTelegramCommandInstallTransport } from "../../src/tanbot/native-create/bot-command-install-provider";
import { buildNativeBotCommandInstallPlan } from "../../src/tanbot/native-create/bot-command-registry";

type Provider = "max" | "telegram";
type Call = { path: string; init: RequestInit & { dispatcher?: { close(): Promise<void> } } };
type Options = { readFailure?: boolean; malformed?: boolean; menuFailure?: boolean; webApp?: boolean;
  badWrite?: string; missingAck?: string; throwWrite?: boolean; size?: number };
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const dispatchers = new Set<{ close(): Promise<void> }>();
beforeEach(() => {
  Object.assign(process.env, {
    APP_ORIGIN: "http://127.0.0.1:3000", NODE_ENV: "test",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_BOT_TOKEN: "SYNTH_PRIVATE_COMMAND_TOKEN", TANBOT_MAX_BOT_USERNAME: "synthetic_menu_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-menu-pepper-for-max", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-menu-max-secret",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_PRIVATE_COMMAND_TOKEN", TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_menu_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-menu-pepper-for-telegram", TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-menu-tg-secret",
  });
  delete process.env.TANBOT_MAX_TLS_CA_BUNDLE;
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const dispatcher of dispatchers) await dispatcher.close();
  dispatchers.clear();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function mock(provider: Provider, options: Options = {}) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init = {}) => {
    const u = new URL(String(input));
    assert.equal(u.hostname, provider === "max" ? "platform-api2.max.ru" : "api.telegram.org");
    assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
    const typedInit = init as Call["init"];
    if (typedInit.dispatcher) dispatchers.add(typedInit.dispatcher);
    const path = provider === "max" ? u.pathname : u.pathname.split("/").at(-1)!;
    calls.push({ path, init: typedInit });
    const write = ["POST", "PATCH"].includes(init.method ?? "GET");
    if (write && options.throwWrite) throw new Error("SYNTH_PRIVATE_COMMAND_TOKEN must not escape");
    const existing = Array.from({ length: options.size ?? 1 }, (_, i) => ({
      command: `custom_${i}`, description: `Неуправляемая команда ${i}`,
    }));
    let data: unknown;
    let status = 200;
    if (provider === "telegram") {
      if (path === "getMyCommands") data = options.readFailure
        ? { ok: false, description: "SYNTH_PRIVATE_COMMAND_TOKEN must not escape" }
        : { ok: true, result: options.malformed ? "invalid-list" : existing };
      else if (path === "getChatMenuButton") {
        data = options.webApp ? { ok: true, result: { type: "web_app", text: "Существующее приложение",
          web_app: { url: "https://example.org/existing-app" } } } : { ok: true, result: { type: "commands" } };
        if (options.menuFailure) { status = 503; data = { ok: false }; }
      } else if (path === "setMyCommands" || path === "setChatMenuButton") {
        data = options.missingAck === path ? { ok: true } : { ok: options.badWrite !== path, result: options.badWrite !== path };
      } else assert.fail("unexpected Telegram command-install endpoint");
    } else {
      if (path === "/me") {
        if (options.readFailure) { status = 503; data = { code: "unavailable" }; }
        else data = { user_id: 123, first_name: "Synthetic", is_bot: true,
          commands: options.malformed ? "invalid-list" : existing.map(x => ({ name: x.command, description: x.description })) };
      } else if (path === "/me/commands") data = { success: options.badWrite !== path };
      else assert.fail("unexpected MAX command-install endpoint");
    }
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = impl; // catches any accidental bypass as well; separate test explicitly rejects bypass
  return { calls, impl };
}
function factory(provider: Provider, impl: typeof fetch) {
  return provider === "max" ? createMaxCommandInstallTransport(impl) : createTelegramCommandInstallTransport(impl);
}
function writes(calls: Call[]) { return calls.filter(c => ["POST", "PATCH"].includes(c.init.method ?? "GET")); }
for (const provider of ["max", "telegram"] as const) {
  it(`${provider} actual installer HTTP adapter preserves unmanaged commands and validates successful acknowledgements`, async () => {
    const { calls, impl } = mock(provider);
    const r = await factory(provider, impl)(buildNativeBotCommandInstallPlan(provider, { dryRun: false }));
    assert.equal(r.ok, true);
    const set = writes(calls).find(c => provider === "max" ? c.path === "/me/commands" : c.path === "setMyCommands"); assert.ok(set);
    const payload = JSON.parse(String(set.init.body));
    assert.equal(payload.commands.length, 5);
    assert.ok(payload.commands.some((c: { name?: string; command?: string }) => (c.name ?? c.command) === "custom_0"));
    if (provider === "telegram") assert.deepEqual(payload.scope, { type: "default" });
  });
  for (const kind of ["readFailure", "malformed"] as const) {
    it(`${provider} ${kind} never becomes an empty command list that overwrites provider settings`, async () => {
      const { calls, impl } = mock(provider, { [kind]: true });
      const r = await factory(provider, impl)(buildNativeBotCommandInstallPlan(provider, { dryRun: false }));
      assert.equal(r.ok, false); assert.equal(writes(calls).length, 0);
      assert.ok(!JSON.stringify(r).includes("SYNTH_PRIVATE_COMMAND_TOKEN"));
    });
  }
  it(`${provider} command limit overflow fails before any provider mutation`, async () => {
    const { calls, impl } = mock(provider, { size: provider === "max" ? 29 : 97 });
    const r = await factory(provider, impl)(buildNativeBotCommandInstallPlan(provider, { dryRun: false }));
    assert.equal(r.ok, false); assert.equal(writes(calls).length, 0);
  });
  it(`${provider} HTTP 200 with a negative write acknowledgement is a failure, not successful registration`, async () => {
    const { calls, impl } = mock(provider, { badWrite: provider === "max" ? "/me/commands" : "setMyCommands" });
    const r = await factory(provider, impl)(buildNativeBotCommandInstallPlan(provider, { dryRun: false }));
    assert.equal(r.ok, false); assert.equal(writes(calls).length, 1);
  });
  it(`${provider} write transport errors are returned safely without raw token-bearing exception messages`, async () => {
    const { impl } = mock(provider, { throwWrite: true });
    const r = await factory(provider, impl)(buildNativeBotCommandInstallPlan(provider, { dryRun: false }));
    assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes("SYNTH_PRIVATE_COMMAND_TOKEN"));
  });
}
it("Telegram unavailable existing menu state fails closed before any command/menu mutation", async () => {
  const { calls, impl } = mock("telegram", { menuFailure: true });
  const r = await factory("telegram", impl)(buildNativeBotCommandInstallPlan("telegram", { dryRun: false }));
  assert.equal(r.ok, false); assert.equal(writes(calls).length, 0);
});
it("Telegram preserves existing WebApp menu instead of replacing it with commands", async () => {
  const { calls, impl } = mock("telegram", { webApp: true });
  const r = await factory("telegram", impl)(buildNativeBotCommandInstallPlan("telegram", { dryRun: false }));
  assert.equal(r.ok, true);
  assert.deepEqual(writes(calls).map(c => c.path), ["setMyCommands"]);
});
it("Telegram failed menu acknowledgement is reported as partial failure, not success", async () => {
  const { impl } = mock("telegram", { badWrite: "setChatMenuButton" });
  const r = await factory("telegram", impl)(buildNativeBotCommandInstallPlan("telegram", { dryRun: false }));
  assert.equal(r.ok, false);
});
for (const path of ["setMyCommands", "setChatMenuButton"]) {
  it(`Telegram ${path} missing positive result is malformed and must not be treated as registration success`, async () => {
    const { impl } = mock("telegram", { missingAck: path });
    const r = await factory("telegram", impl)(buildNativeBotCommandInstallPlan("telegram", { dryRun: false }));
    assert.equal(r.ok, false);
  });
}
it("Telegram all reads use the injected recording transport instead of bypassing it via global fetch", async () => {
  const { impl } = mock("telegram");
  let bypass = 0;
  globalThis.fetch = async () => { bypass++; throw new Error("No unrecorded network permitted"); };
  const r = await factory("telegram", impl)(buildNativeBotCommandInstallPlan("telegram", { dryRun: false }));
  assert.equal(r.ok, true); assert.equal(bypass, 0);
});
it("MAX command GET and PATCH both honor existing custom TLS dispatcher configuration", async () => {
  process.env.TANBOT_MAX_TLS_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
  const { calls, impl } = mock("max");
  const r = await factory("max", impl)(buildNativeBotCommandInstallPlan("max", { dryRun: false }));
  assert.equal(r.ok, true);
  for (const path of ["/me", "/me/commands"]) assert.ok(calls.find(c => c.path === path)?.init.dispatcher, path);
});
