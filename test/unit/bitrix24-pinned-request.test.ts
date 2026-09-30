import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, afterEach, it } from "node:test";
import {
  executePinnedHttpsRequest,
  setHttpsRequestImplForTests,
} from "../../src/bitrix24/pinned-request";

type MockState = {
  reqDestroyed: boolean;
  resDestroyed: boolean;
  resumed: boolean;
  reqOptions?: Record<string, unknown>;
};

function createMockHttps(state: MockState, responseFactory: () => EventEmitter & { statusCode?: number }) {
  return ((_options: unknown, callback: (res: EventEmitter & { statusCode?: number }) => void) => {
    state.reqOptions = _options as Record<string, unknown>;
    const req = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      write: () => void;
      end: () => void;
      destroy: () => void;
    };
    req.destroyed = false;
    req.write = () => undefined;
    req.end = () => {
      const res = responseFactory();
      callback(res);
    };
    req.destroy = () => {
      req.destroyed = true;
      state.reqDestroyed = true;
      req.emit("close");
    };
    return req;
  }) as typeof import("node:https").request;
}

afterEach(() => {
  setHttpsRequestImplForTests(null);
});

describe("executePinnedHttpsRequest cleanup", () => {
  it("destroys redirect request/response without resuming body", async () => {
    const state: MockState = { reqDestroyed: false, resDestroyed: false, resumed: false };
    setHttpsRequestImplForTests(
      createMockHttps(state, () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          destroyed: boolean;
          destroy: () => void;
          resume: () => void;
        };
        res.statusCode = 302;
        res.destroyed = false;
        res.resume = () => {
          state.resumed = true;
        };
        res.destroy = () => {
          res.destroyed = true;
          state.resDestroyed = true;
        };
        queueMicrotask(() => res.emit("data", Buffer.from("redirect-body")));
        return res;
      }),
    );

    await assert.rejects(
      executePinnedHttpsRequest({
        url: new URL("https://example.bitrix24.ru/rest/1/token/user.get"),
        pinned: { address: "93.184.216.34", family: 4 },
        method: "POST",
        headers: {},
        body: "{}",
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      }),
      /REDIRECT_BLOCKED/,
    );

    assert.equal(state.reqDestroyed, true);
    assert.equal(state.resDestroyed, true);
    assert.equal(state.resumed, false);
  });

  it("preserves pinned host, SNI and TLS verification options", async () => {
    const state: MockState = { reqDestroyed: false, resDestroyed: false, resumed: false };
    setHttpsRequestImplForTests(
      createMockHttps(state, () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy: () => void;
        };
        res.statusCode = 200;
        res.headers = {};
        res.destroy = () => undefined;
        queueMicrotask(() => {
          res.emit("data", Buffer.from('{"result":[]}'));
          res.emit("end");
        });
        return res;
      }),
    );

    await executePinnedHttpsRequest({
      url: new URL("https://example.bitrix24.ru/rest/1/token/user.get"),
      pinned: { address: "93.184.216.34", family: 4 },
      method: "POST",
      headers: { Accept: "application/json" },
      body: "{}",
      timeoutMs: 1000,
      maxResponseBytes: 1024,
    });

    assert.equal(state.reqOptions?.host, "93.184.216.34");
    assert.equal(state.reqOptions?.servername, "example.bitrix24.ru");
    assert.equal(state.reqOptions?.rejectUnauthorized, true);
    assert.equal((state.reqOptions?.headers as Record<string, string>).Host, "example.bitrix24.ru");
  });

  it("rejects already aborted signal before opening request", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      executePinnedHttpsRequest({
        url: new URL("https://example.bitrix24.ru/rest/1/token/user.get"),
        pinned: { address: "93.184.216.34", family: 4 },
        method: "POST",
        headers: {},
        body: "{}",
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        signal: controller.signal,
      }),
      /ABORTED/,
    );
  });
});
