import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";
const require = createRequire(import.meta.url);
const icons = require("../../public/brand/shell-icons.js");

it("clients and sales use separate Lucide outlines matching the supplied prototype", () => {
  assert.match(icons.clients, /<circle cx="9" cy="7" r="4"/);
  assert.match(icons.clients, /M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2/);
  assert.doesNotMatch(icons.clients, /ellipse/);
  assert.match(icons.sales, /M20 10v11/);
  assert.match(icons.sales, /m22 3-8\.646 8\.646/);
  assert.notEqual(icons.clients, icons.sales);
  for (const svg of [icons.clients, icons.sales]) {
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
  }
  const shell = fs.readFileSync(path.join(process.cwd(), "public/clients-shell.js"), "utf8");
  assert.match(shell, /navLink\("\/sales", "Продажи", "sales"/);
});
