import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import request from "supertest";
import http from "node:http";

const PREVIEW = "https://lk.tandoor.ru/brand/tandoor-tracker-preview-v1.png";

function assertGenericOg(html: string): void {
  assert.match(html, /property="og:title" content="Тандор · Передачи под контролем"/);
  assert.match(html, /property="og:image" content="https:\/\/lk\.tandoor\.ru\/brand\/tandoor-tracker-preview-v1\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(html, /property="og:url"/);
  assert.doesNotMatch(html, /cap=|tt_hat=|est=/);
}

describe("tan-tracker public preview metadata", () => {
  it("tan-tracker.html and recipient shell expose generic OG tags", () => {
    assertGenericOg(readFileSync("public/tan-tracker.html", "utf8"));
    assertGenericOg(readFileSync("public/tan-tracker-recipient.html", "utf8"));
  });

  it("serves brand preview PNG without auth", async () => {
    const { createApp } = await import("../../src/server");
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await request(`http://127.0.0.1:${port}`).get("/brand/tandoor-tracker-preview-v1.png");
      assert.equal(res.status, 200);
      assert.match(String(res.headers["content-type"] || ""), /image\/png/i);
      assert.ok((res.body as Buffer).length > 10_000);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
