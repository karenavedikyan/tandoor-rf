import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseXmlBufferSafely } from "../../src/onec-catalog/safe-xml";

describe("onec catalog safe xml", () => {
  it("rejects DOCTYPE and invalid root", async () => {
    const doctype = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "x">]><Группы></Группы>`,
      "utf8",
    );
    const badRoot = Buffer.from(`<?xml version="1.0"?><Wrong></Wrong>`, "utf8");
    const doctypeResult = await parseXmlBufferSafely(
      { bytes: doctype, file: "catalog/groups/data.xml", expectedRoot: "Группы" },
      {},
    );
    assert.equal(doctypeResult.issue?.code, "XML_DOCTYPE_FORBIDDEN");

    const rootResult = await parseXmlBufferSafely(
      { bytes: badRoot, file: "catalog/groups/data.xml", expectedRoot: "Группы" },
      {},
    );
    assert.equal(rootResult.issue?.code, "XML_INVALID_ROOT");
  });

  it("parses cyrillic attributes", async () => {
    const xml = Buffer.from(
      `<?xml version="1.0"?><Группы><Группа Код="g1" Родитель=""/></Группы>`,
      "utf8",
    );
    const seen: string[] = [];
    const parsed = await parseXmlBufferSafely(
      { bytes: xml, file: "catalog/groups/data.xml", expectedRoot: "Группы" },
      {
        onOpenTag: (name, attrs) => {
          if (name === "Группа") seen.push(attrs["Код"] ?? "");
        },
      },
    );
    assert.equal(parsed.issue, undefined);
    assert.deepEqual(seen, ["g1"]);
  });
});
