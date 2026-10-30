import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMaxMediaDownloadUrl } from "../../src/tanbot-max/max-media-url";

describe("validateMaxMediaDownloadUrl", () => {
  it("accepts official oneme CDN https URL", () => {
    const r = validateMaxMediaDownloadUrl("https://iu.oneme.ru/getImage?token=abc");
    assert.equal(r.ok, true);
  });

  it("rejects http, userinfo, non-default port, localhost, private IP, arbitrary host", () => {
    assert.equal(validateMaxMediaDownloadUrl("http://iu.oneme.ru/x").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://user:pass@iu.oneme.ru/x").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://iu.oneme.ru:8080/x").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://localhost/secret").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://127.0.0.1/secret").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://192.168.1.1/x").ok, false);
    assert.equal(validateMaxMediaDownloadUrl("https://attacker.example/steal").ok, false);
  });
});
