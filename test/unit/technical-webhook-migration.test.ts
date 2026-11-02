import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_BOT_ORIGIN as OLD, TECHNICAL_BOT_ORIGIN as NEW,
  migrateTelegramWebhook, migrateMaxWebhook } from "../../src/tanbot/technical-webhook-migration";
import { ensureApprovedTechnicalWebhooks, isApprovedTechnicalWebhookRuntime } from "../../src/tanbot/technical-webhook-startup";
import type { Pool } from "pg";

const config = { token: "123456:FAKE_OPERATOR_TEST_TOKEN_ONLY", secret: "Fake_Operator_Secret_12345", expectedUsername: "TANDOOR_IBOT" };
const tgOld = `${OLD}/api/tanbot-telegram/webhook`, tgNew = `${NEW}/api/tanbot-telegram/webhook`;
const maxOld = `${OLD}/api/tanbot-max/webhook`, maxNew = `${NEW}/api/tanbot-max/webhook`;
type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const routeFetch = (async (_url: unknown, init?: RequestInit) => {
  assert.equal(init?.method, "POST");
  assert.equal(init?.body, "[]", "route probe cannot look like an incoming bot event");
  assert.equal(init?.redirect, "error");
  const headers = new Headers(init?.headers);
  const secret = headers.get("X-Telegram-Bot-Api-Secret-Token") || headers.get("X-Max-Bot-Api-Secret");
  if (secret) assert.equal(secret, config.secret);
  return json({}, secret ? 400 : 403);
}) as typeof fetch;

function telegram(options: { url?: string; me?: unknown; info?: Record<string, unknown>;
  setFailure?: boolean; verifyFailure?: boolean; network?: boolean } = {}) {
  const calls: Call[] = [];
  let changed = false;
  const info = { url: options.url ?? tgOld, has_custom_certificate: false, max_connections: 32,
    allowed_updates: ["message", "callback_query"], pending_update_count: 9, ...options.info };
  const api = (async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    assert.equal(init?.redirect, "error");
    if (options.network) throw new Error(`sensitive ${config.token} ${config.secret}`);
    const operation = url.split("/").at(-1);
    if (operation === "getMe") return json({ ok: true, result: options.me ?? { id: 1, is_bot: true, username: config.expectedUsername } });
    if (operation === "getWebhookInfo") return json({ ok: true,
      result: { ...info, ...(changed && !options.verifyFailure ? { url: tgNew } : {}) } });
    assert.equal(operation, "setWebhook");
    assert.equal(method, "POST");
    changed = !options.setFailure;
    return json({ ok: !options.setFailure, result: !options.setFailure });
  }) as typeof fetch;
  return { calls, api };
}
type Sub = { url: string; update_types?: string[] | null };
const events = ["message_created", "bot_started", "bot_stopped"];
const foreign = { url: "https://other.example/hook?private=NEVER_LOG", update_types: ["message_created"] };
function max(options: { subs?: Sub[]; me?: unknown; addFailure?: boolean; missingNew?: boolean;
  changedForeign?: boolean; deleteFailure?: boolean; invalidList?: boolean; network?: boolean } = {}) {
  const calls: Call[] = [];
  let subs: Sub[] = structuredClone(options.subs ?? [{ url: maxOld, update_types: events }, foreign]);
  const api = (async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    assert.equal(new Headers(init?.headers).get("Authorization"), config.token);
    assert.equal(init?.redirect, "error");
    if (options.network) throw new Error(`sensitive ${config.token} ${config.secret}`);
    if (url.endsWith("/me")) return json(options.me ?? { user_id: 1, is_bot: true, username: config.expectedUsername });
    if (method === "GET") return json({ subscriptions: options.invalidList ? "invalid" : subs });
    if (method === "POST") {
      if (!options.addFailure && !options.missingNew) {
        subs.push({ url: String(body!.url), update_types: body!.update_types as string[] | undefined });
        if (options.changedForeign) subs = subs.filter(sub => sub.url !== foreign.url);
      }
      return json({ success: !options.addFailure });
    }
    assert.equal(method, "DELETE");
    assert.equal(new URL(url).searchParams.get("url"), maxOld);
    if (!options.deleteFailure) subs = subs.filter(sub => sub.url !== maxOld);
    return json({ success: !options.deleteFailure });
  }) as typeof fetch;
  return { calls, api, subscriptions: () => subs };
}
const writes = (calls: Call[]) => calls.filter(call => call.method !== "GET");

describe("approved Telegram technical webhook migration", () => {
  it("preserves secret, event filters, connection limit and pending updates, then verifies URL", async () => {
    const io = telegram();
    const result = await migrateTelegramWebhook(config, io.api, routeFetch);
    assert.equal(result.status, "switched");
    assert.equal(result.pendingUpdates, 9);
    assert.deepEqual(writes(io.calls).map(call => call.body), [{
      url: tgNew, secret_token: config.secret, drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"], max_connections: 32,
    }]);
    assert.equal(io.calls.at(-1)!.url.split("/").at(-1), "getWebhookInfo");
  });
  it("is read-only when the technical URL is already installed", async () => {
    const io = telegram({ url: tgNew });
    assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).status, "already_technical");
    assert.equal(writes(io.calls).length, 0);
  });
  it("accepts the existing trailing slash without broadening the URL allowlist", async () => {
    const io = telegram({ url: `${tgOld}/` });
    assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).status, "switched");
  });
  for (const url of ["", "https://foreign.example/hook", `${tgOld}?secret=hidden`, `${tgOld}/other`, `http://lk.tandoor.ru/api/tanbot-telegram/webhook`]) {
    it(`does not take over unverified registration ${url}`, async () => {
      const io = telegram({ url });
      assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).code, "UNVERIFIED_WEBHOOK");
      assert.equal(writes(io.calls).length, 0);
    });
  }
  for (const me of [{ id: 1, is_bot: true, username: "other_bot" }, { id: 1, is_bot: false, username: config.expectedUsername }]) {
    it("blocks a bot identity mismatch before changing anything", async () => {
      const io = telegram({ me });
      assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).code, "BOT_IDENTITY_MISMATCH");
      assert.equal(writes(io.calls).length, 0);
    });
  }
  for (const info of [{ has_custom_certificate: true }, { max_connections: 101 }, { allowed_updates: "message" }]) {
    it("does not discard unknown or malformed settings", async () => {
      const io = telegram({ info });
      assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).status, "blocked");
      assert.equal(writes(io.calls).length, 0);
    });
  }
  it("does not invent optional filters or limits when the API omits them", async () => {
    const io = telegram({ info: { max_connections: undefined, allowed_updates: undefined } });
    assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).status, "switched");
    assert.deepEqual(Object.keys(writes(io.calls)[0].body!).sort(), ["drop_pending_updates", "secret_token", "url"]);
  });
  it("does not claim success when setWebhook fails", async () => {
    const io = telegram({ setFailure: true });
    assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).status, "failed");
  });
  it("does not claim success if the read-back still points to the old address", async () => {
    const io = telegram({ verifyFailure: true });
    assert.equal((await migrateTelegramWebhook(config, io.api, routeFetch)).code, "VERIFY_FAILED");
  });
});

describe("approved MAX technical webhook migration", () => {
  it("adds and verifies the new subscription before deleting only the old owned URL", async () => {
    const io = max();
    const result = await migrateMaxWebhook(config, io.api, routeFetch);
    assert.equal(result.status, "switched");
    assert.equal(result.foreignSubscriptionsPreserved, true);
    assert.deepEqual(writes(io.calls).map(call => call.method), ["POST", "DELETE"]);
    assert.deepEqual(writes(io.calls)[0].body, { url: maxNew, secret: config.secret, update_types: events });
    const add = io.calls.findIndex(call => call.method === "POST");
    const remove = io.calls.findIndex(call => call.method === "DELETE");
    assert.equal(io.calls[add + 1].method, "GET");
    assert.ok(remove > add + 1);
    assert.deepEqual(io.subscriptions().find(sub => sub.url === foreign.url), foreign);
    assert.equal(io.calls.at(-1)!.method, "GET");
  });
  it("is read-only when already technical, preserving unrelated subscriptions", async () => {
    const io = max({ subs: [{ url: maxNew, update_types: events }, foreign] });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).status, "already_technical");
    assert.equal(writes(io.calls).length, 0);
  });
  it("can finish a previously interrupted add without creating another subscription", async () => {
    const io = max({ subs: [{ url: maxOld, update_types: events }, { url: maxNew, update_types: events }, foreign] });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).status, "switched");
    assert.deepEqual(writes(io.calls).map(call => call.method), ["DELETE"]);
  });
  for (const subs of [[], [foreign]]) {
    it("never treats empty/foreign-only subscriptions as permission to register", async () => {
      const io = max({ subs });
      assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "UNVERIFIED_WEBHOOK");
      assert.equal(writes(io.calls).length, 0);
    });
  }
  for (const options of [{ addFailure: true }, { missingNew: true }, { changedForeign: true }]) {
    it("never removes the old subscription if creating or verifying the replacement failed", async () => {
      const io = max(options);
      assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).status, "failed");
      assert.equal(io.calls.some(call => call.method === "DELETE"), false);
    });
  }
  it("does not remove old subscription when an existing target has different event filters", async () => {
    const io = max({ subs: [{ url: maxOld, update_types: events }, { url: maxNew, update_types: ["bot_started"] }] });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "SUBSCRIPTION_TYPES_MISMATCH");
    assert.equal(writes(io.calls).length, 0);
  });
  it("keeps a verified new subscription if old subscription removal fails", async () => {
    const io = max({ deleteFailure: true });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).status, "failed");
    assert.ok(io.subscriptions().some(sub => sub.url === maxNew));
    assert.ok(io.subscriptions().some(sub => sub.url === maxOld));
  });
  it("does not replace an unspecified event filter with undocumented defaults", async () => {
    const io = max({ subs: [{ url: maxOld, update_types: null }] });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "UNSPECIFIED_EVENT_FILTER");
    assert.equal(writes(io.calls).length, 0);
  });
  it("blocks ambiguous owned subscriptions without deletion", async () => {
    const io = max({ subs: [{ url: maxOld }, { url: `${maxOld}/` }] });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "AMBIGUOUS_LEGACY_SUBSCRIPTION");
    assert.equal(writes(io.calls).length, 0);
  });
  it("does not silently discard malformed API entries", async () => {
    const io = max({ invalidList: true });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "INVALID_API_RESPONSE");
    assert.equal(writes(io.calls).length, 0);
  });
  it("blocks bot identity mismatch", async () => {
    const io = max({ me: { user_id: 1, is_bot: true, username: "foreign_bot" } });
    assert.equal((await migrateMaxWebhook(config, io.api, routeFetch)).code, "BOT_IDENTITY_MISMATCH");
    assert.equal(writes(io.calls).length, 0);
  });
});

describe("operator migration safety boundaries", () => {
  for (const [name, create, migrate] of [
    ["telegram", telegram, migrateTelegramWebhook], ["max", max, migrateMaxWebhook],
  ] as const) {
    it(`${name}: blocks invalid secrets before any request`, async () => {
      const io = create();
      assert.equal((await migrate({ ...config, secret: "bad secret" }, io.api, routeFetch)).code, "INVALID_SECRET");
      assert.equal(io.calls.length, 0);
    });
    for (const status of [200, 302, 401, 404, 500]) {
      it(`${name}: cannot switch when the technical endpoint is not securely reachable (${status})`, async () => {
        const io = create();
        const probe = (async () => json({}, status)) as typeof fetch;
        assert.equal((await migrate(config, io.api, probe)).code, "ROUTE_AUTH_MISMATCH");
        assert.equal(writes(io.calls).length, 0);
      });
    }
    it(`${name}: route network failure cannot cause mutation`, async () => {
      const io = create();
      const probe = (async () => { throw new Error(config.secret); }) as typeof fetch;
      assert.equal((await migrate(config, io.api, probe)).code, "ROUTE_UNREACHABLE");
      assert.equal(writes(io.calls).length, 0);
    });
    it(`${name}: rejects a route that rejects unsigned requests but mishandles the configured secret`, async () => {
      const io = create();
      const probe = (async (_url: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        return json({}, headers.has("X-Telegram-Bot-Api-Secret-Token") || headers.has("X-Max-Bot-Api-Secret") ? 200 : 403);
      }) as typeof fetch;
      assert.equal((await migrate(config, io.api, probe)).code, "ROUTE_AUTH_MISMATCH");
      assert.equal(writes(io.calls).length, 0);
    });
    it(`${name}: errors never expose tokens, secrets or raw exception text`, async () => {
      const io = create({ network: true });
      const result = await migrate(config, io.api, routeFetch);
      assert.equal(result.code, "API_NETWORK_ERROR");
      assert.equal(JSON.stringify(result).includes(config.token), false);
      assert.equal(JSON.stringify(result).includes(config.secret), false);
    });
  }
  it("runs only for the approved production origin", () => {
    assert.equal(isApprovedTechnicalWebhookRuntime({ NODE_ENV: "production", APP_ORIGIN: OLD }), true);
    assert.equal(isApprovedTechnicalWebhookRuntime({ NODE_ENV: "production", APP_ORIGIN: `${OLD}/` }), true);
    for (const env of [{}, { NODE_ENV: "test", APP_ORIGIN: OLD },
      { NODE_ENV: "production", APP_ORIGIN: "https://other.example" },
      { NODE_ENV: "production", APP_ORIGIN: OLD, TT_USER_TEST_ENV: "true" }]) {
      assert.equal(isApprovedTechnicalWebhookRuntime(env), false);
    }
  });
  it("never opens a database connection outside the approved runtime", async () => {
    const pool = { connect: () => { throw new Error("must not connect"); } } as unknown as Pool;
    await ensureApprovedTechnicalWebhooks(pool, { NODE_ENV: "test", APP_ORIGIN: OLD });
    await ensureApprovedTechnicalWebhooks(pool, { NODE_ENV: "production", APP_ORIGIN: OLD, TT_USER_TEST_ENV: "true" });
  });
  it("does not run a competing migration while another instance owns the lock", async () => {
    const calls: string[] = [];
    let released = false;
    const client = { query: async (sql: string) => { calls.push(sql); return { rows: [{ locked: false }] }; },
      release: () => { released = true; } };
    await ensureApprovedTechnicalWebhooks({ connect: async () => client } as unknown as Pool,
      { NODE_ENV: "production", APP_ORIGIN: OLD });
    assert.equal(calls.length, 1);
    assert.equal(released, true);
  });
  it("releases its advisory lock and does not enable unconfigured integrations", async () => {
    const calls: string[] = [];
    let released = false;
    const client = { query: async (sql: string) => { calls.push(sql); return { rows: [{ locked: true }] }; },
      release: () => { released = true; } };
    await ensureApprovedTechnicalWebhooks({ connect: async () => client } as unknown as Pool,
      { NODE_ENV: "production", APP_ORIGIN: OLD });
    assert.equal(calls.length, 2);
    assert.match(calls[1], /pg_advisory_unlock/);
    assert.equal(released, true);
  });
});
