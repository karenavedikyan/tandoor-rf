#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const filterNumberPath = path.join(root, "public/clients-v3-filter-number.js");
const focusPath = path.join(root, "public/clients-lktandoor-focus.js");

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(filterNumberPath, "utf8"), ctx);
const normalize = ctx.window.ClientsV3FilterNumber.normalizeListFilterNumberValue;

const samples = ["1e-20", "1e21", "9007199254740993", "1e3", "Infinity", "NaN", "0x10"];
const results = {};
for (const sample of samples) {
  results[sample] = normalize(sample);
}

const payload = {
  generatedAt: new Date().toISOString(),
  shippedFiles: {
    filterNumber: path.relative(root, filterNumberPath),
    focus: path.relative(root, focusPath),
  },
  normalizeListFilterNumberValue: results,
};

const outPath = path.join(__dirname, "tandoor-pr102-independent-probes.json");
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload, null, 2));
