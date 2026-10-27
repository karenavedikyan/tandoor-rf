import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

function setup() {
  const dom = new JSDOM(fs.readFileSync(path.resolve("public/change-password.html"), "utf8"), {
    runScripts: "outside-only", url: "https://example.test/change-password",
  });
  const calls: Array<{ url: string; options: unknown }> = [];
  Object.assign(dom.window, { TandoorRf: {
    apiRequest(url: string, options: unknown) {
      calls.push({ url, options });
      return Promise.resolve({ response: { status: 503 }, data: null });
    },
    setStatus() {}, extractErrorMessage: () => "Ошибка", mapRequestError: () => "Ошибка",
  } });
  dom.window.eval(fs.readFileSync(path.resolve("public/change-password.js"), "utf8"));
  return { dom, doc: dom.window.document, calls };
}

test("all password fields start masked and toggle independently without requests", () => {
  const { dom, doc, calls } = setup();
  const inputs = ["current-password", "new-password", "confirm-password"]
    .map(id => doc.getElementById(id) as HTMLInputElement);
  assert.equal(doc.querySelectorAll("[data-password-toggle]").length, 3);
  inputs.forEach((input, i) => {
    input.value = `TestOnlyPassword-${i}!`;
    assert.equal(input.type, "password");
  });
  inputs.forEach(input => {
    const button = doc.querySelector(`[data-password-toggle="${input.id}"]`) as HTMLButtonElement;
    assert.equal(button.type, "button");
    assert.equal(button.getAttribute("aria-controls"), input.id);
    button.click();
    assert.equal(input.type, "text");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.match(button.getAttribute("aria-label")!, /^Скрыть /);
    inputs.filter(other => other !== input).forEach(other => assert.equal(other.type, "password"));
    button.click();
    assert.equal(input.type, "password");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(input.value, `TestOnlyPassword-${inputs.indexOf(input)}!`);
  });
  assert.equal(calls.length, 1); // Existing session check only, never a login/save.
  dom.window.close();
});

test("submit re-masks all fields without changing the password payload", async () => {
  const { dom, doc, calls } = setup();
  for (const id of ["current-password", "new-password", "confirm-password"]) {
    (doc.getElementById(id) as HTMLInputElement).value = "TestOnlyPassword123!";
    (doc.querySelector(`[data-password-toggle="${id}"]`) as HTMLButtonElement).click();
  }
  doc.getElementById("change-password-form")!.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options)), {
    method: "POST", body: { currentPassword: "TestOnlyPassword123!", newPassword: "TestOnlyPassword123!" },
  });
  doc.querySelectorAll<HTMLInputElement>("input[autocomplete$='password']").forEach(input => assert.equal(input.type, "password"));
  await Promise.resolve();
  dom.window.close();
});
