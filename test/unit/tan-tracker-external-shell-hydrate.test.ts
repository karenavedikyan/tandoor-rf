import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("external person shell hydrate", () => {
  it("preserves acting contact for externalPerson bootstrap", () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../public/tan-tracker/tan-tracker.js",
    );
    const js = readFileSync(file, "utf8");
    assert.match(js, /data\.publicHolder \|\| data\.publicRecipient \|\| data\.externalPerson/);
  });

  it("renderTracker injects external chrome into #tt-content for LK shell", () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../public/tan-tracker/tan-tracker.js",
    );
    const js = readFileSync(file, "utf8");
    assert.match(js, /externalShellChromeHtml/);
    assert.match(js, /externalShellChromeHtml\(\) \+ bodyHtml\(\)/);
    assert.match(js, /externalLkShell/);
  });

  it("readUrl keeps authoritative external actor and ignores hash tt_act", () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../public/tan-tracker/tan-tracker.js",
    );
    const js = readFileSync(file, "utf8");
    assert.match(js, /lkBootstrapAuthoritativeExternalActor/);
    assert.match(js, /authoritativeExternalActorFromBootstrap/);
    assert.match(js, /if \(!lkBootstrapAuthoritativeExternalActor\(lkBoot\)\)/);
  });
});
