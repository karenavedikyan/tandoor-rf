import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";
import { parseHandoffCodePaste } from "../../src/tan-tracker/handoff-code-paste-parse";

const sandbox = { window: {} as { TanTrackerHandoffCodePaste?: { parseHandoffCodePaste: typeof parseHandoffCodePaste } } };
runInNewContext(readFileSync("public/tan-tracker/handoff-code-paste.js", "utf8"), sandbox);
const browserParse = sandbox.window.TanTrackerHandoffCodePaste!.parseHandoffCodePaste;
const samples: Array<[string, string | null]> = [
  ["012345", "012345"],
  ["0 1 2 3 4 5", "012345"],
  ["Код для передачи TT-2026-001: 012345\nДействует 10 минут. Телефон +79991234567.", "012345"],
  ["Код: 012345\nПовтор кода: 012345", "012345"],
  ["Код: 111111\nКод: 222222", null],
  ["Передача TT-2026-123456. Код пока не получен.", null],
  ["Код пока не получен. Передача TT-2026-123456.", null],
  ["Код уточните у получателя +7 (999) 123-45-67. Действует 10 минут.", null],
  ["TT-2026-001 10 минут +79991234567", null],
  ["1234567890123456", null],
];

describe("independent browser/server paste parsing parity", () => {
  for (const [text, expected] of samples) it(JSON.stringify(text), () => {
    const server = parseHandoffCodePaste(text);
    const browser = JSON.parse(JSON.stringify(browserParse(text)));
    assert.deepEqual(browser, server, "shipped browser parser matches the server-tested implementation");
    assert.equal(server.ok ? server.code : null, expected, "a track suffix, phone or TTL is not an OTP");
  });
});
