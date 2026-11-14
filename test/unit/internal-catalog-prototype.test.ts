import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("keeps the supplied catalog-v1 stylesheet and Golos font byte-identical to the prototype", async () => {
  for (const [file, hash] of [
    ["public/catalog-prototype.css", "ef0d42b1a6aa3bb4ead1fa8531911b0e7b90a0748cbc28a86062430248267481"],
    ["public/fonts/golos/Golos.ttf", "17bb58fb69aec2dfb047a2ebf52534023e9b688c97a6b7ac795b0a72912c2063"],
  ]) assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), hash, file);
});
