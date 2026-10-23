import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("sales section category attribute XSS", () => {
  it("does not break out of data attribute when building drill button", () => {
    const malicious = '"><img src=x onerror=alert(1)>';
    const btn = document.createElement("button");
    btn.setAttribute("data-drill-category", malicious);
    assert.equal(btn.getAttribute("data-drill-category"), malicious);
    assert.equal(btn.outerHTML.includes('onerror=alert(1)'), true);
    assert.equal(btn.outerHTML.includes('"><img'), false);
  });
});
