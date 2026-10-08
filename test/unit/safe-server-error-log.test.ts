import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Request } from "express";
import { logServerError, safeRouteTemplate } from "../../src/http/safe-server-error-log";

const SECRET_NAME = "SyntheticLprName";
const SECRET_PHONE = "+79001234567";
const SECRET_EMAIL = "sensitive-lpr@example.test";
const SECRET_DOB = "1985-03-15";
const SECRET_TOKEN = "Bearer-test-token-abc123";

function fakeClientsListRequest(): Request {
  return {
    method: "GET",
    path: "/",
    baseUrl: "/api/clients",
    route: { path: "/" },
    originalUrl:
      `/api/clients?lprNameContains=${encodeURIComponent(SECRET_NAME)}` +
      `&lprPhoneContains=${encodeURIComponent(SECRET_PHONE)}` +
      `&lprEmailContains=${encodeURIComponent(SECRET_EMAIL)}` +
      `&lprDateOfBirth=${SECRET_DOB}` +
      `&token=${encodeURIComponent(SECRET_TOKEN)}`,
  } as Request;
}

describe("safe server error logging", () => {
  const originalDebug = process.env.TANDOOR_DEBUG_HTTP_ERRORS;
  let logLines: string[] = [];
  let originalError: typeof console.error;

  afterEach(() => {
    process.env.TANDOOR_DEBUG_HTTP_ERRORS = originalDebug;
    console.error = originalError;
    logLines = [];
  });

  function captureLogs(): void {
    originalError = console.error;
    console.error = (...args: unknown[]) => {
      logLines.push(args.map(String).join(" "));
    };
  }

  function assertNoSecretsInLogs(): void {
    const joined = logLines.join("\n");
    for (const secret of [SECRET_NAME, SECRET_PHONE, SECRET_EMAIL, SECRET_DOB, SECRET_TOKEN]) {
      assert.doesNotMatch(joined, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(joined, /lprNameContains=/);
    assert.doesNotMatch(joined, /79001234567/);
    assert.doesNotMatch(joined, /sensitive-lpr@example\.test/);
    assert.doesNotMatch(joined, /Bearer-test-token/);
    assert.doesNotMatch(joined, /failed bind/i);
  }

  it("logs route template and requestId without query (debug off)", () => {
    captureLogs();
    delete process.env.TANDOOR_DEBUG_HTTP_ERRORS;
    const req = fakeClientsListRequest();
    const ctx = logServerError(
      req,
      500,
      new Error(`synthetic failure phone=${SECRET_PHONE} token=${SECRET_TOKEN}`),
    );
    assert.equal(ctx.route, "/api/clients");
    assert.equal(ctx.method, "GET");
    assert.equal(ctx.status, 500);
    assert.match(ctx.diagnosticId, /^[0-9a-f-]{36}$/i);
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /Server error \(500\) GET \/api\/clients requestId=/);
    assertNoSecretsInLogs();
  });

  it("debug mode logs allowlisted traits only, not message or stack (debug on)", () => {
    captureLogs();
    process.env.TANDOOR_DEBUG_HTTP_ERRORS = "1";
    const req = fakeClientsListRequest();
    const err = Object.assign(new Error(`phone=${SECRET_PHONE} email=${SECRET_EMAIL}`), {
      code: "08P01",
    });
    logServerError(req, 500, err);
    assert.equal(logLines.length, 2);
    assert.match(logLines[0], /Server error \(500\) GET \/api\/clients requestId=/);
    assert.match(logLines[1], /Server error traits requestId=/);
    assert.doesNotMatch(logLines[1], /name=/);
    assert.match(logLines[1], /code=08P01/);
    assertNoSecretsInLogs();
  });

  it("debug mode never logs err.name even when it embeds secrets", () => {
    captureLogs();
    process.env.TANDOOR_DEBUG_HTTP_ERRORS = "1";
    const secretInName = `leak:${SECRET_EMAIL}:${SECRET_TOKEN}`;
    assert.ok(secretInName.length < 64);
    const err = Object.assign(new Error("ignored message"), {
      name: secretInName,
      code: "23505",
    });
    logServerError(fakeClientsListRequest(), 500, err);
    assert.equal(logLines.length, 2);
    assert.match(logLines[1], /code=23505/);
    assert.doesNotMatch(logLines.join("\n"), /name=/);
    assert.doesNotMatch(logLines.join("\n"), new RegExp(SECRET_EMAIL.replace(/\./g, "\\.")));
    assert.doesNotMatch(logLines.join("\n"), /Bearer-test-token/);
  });

  it("safeRouteTemplate never includes query string", () => {
    const req = fakeClientsListRequest();
    assert.equal(safeRouteTemplate(req), "/api/clients");
  });
});
