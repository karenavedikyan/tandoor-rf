import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";
const require = createRequire(import.meta.url);
const icons = require("../../public/brand/shell-icons.js");

const PROTOTYPE_SUBSTITUTION_PATHS = [
  "m2 9 3-3 3 3",
  "M13 18H7a2 2 0 0 1-2-2V6",
  "m22 15-3 3-3-3",
  "M11 6h6a2 2 0 0 1 2 2v10",
] as const;

function extractPathDs(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
}

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

it("substitution (Назначения ассистентам) matches Lucide repeat-2 from prototype", () => {
  const paths = extractPathDs(icons.substitution);
  assert.deepEqual(paths, [...PROTOTYPE_SUBSTITUTION_PATHS]);
  assert.doesNotMatch(icons.substitution, /0-8h1/);
  assert.doesNotMatch(icons.substitution, /0 8h-1/);
  assert.match(icons.substitution, /stroke="currentColor"/);
  assert.match(icons.substitution, /class="legacy-icon"/);
  assert.match(icons.substitution, /aria-hidden="true"/);
  assert.match(icons.substitution, /viewBox="0 0 24 24"/);
  const shell = fs.readFileSync(path.join(process.cwd(), "public/clients-shell.js"), "utf8");
  assert.match(shell, /navLink\("\/access", "Назначения ассистентам", "substitution"/);
});
