import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentDispositionFilename } from "../../src/tan-tracker/attachments";

describe("tan-tracker content disposition", () => {
  it("attachment disposition preserves Cyrillic name via filename*", () => {
    const name = "Закрытый тестовый документ.txt";
    const header = contentDispositionFilename(name, "attachment");
    assert.ok(header.startsWith("attachment;"));
    assert.match(header, /filename="file\.txt"/);
    assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent(name)}`));
  });

  it("keeps ASCII filename in fallback for plain names", () => {
    const header = contentDispositionFilename("report.txt", "attachment");
    assert.ok(header.includes('filename="report.txt"'));
  });
});
