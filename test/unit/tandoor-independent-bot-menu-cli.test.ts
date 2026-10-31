import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { it } from "node:test";

const root = resolve(__dirname, "../..");
const cli = resolve(root, "dist/cli/tanbot-install-messenger-commands.js");
const blocked = "INDEPENDENT_MENU_CLI_NETWORK_BLOCKED";
const preload = `data:text/javascript,${encodeURIComponent(
  `globalThis.fetch=async()=>{process.stderr.write("${blocked}");throw new Error("network prohibited in independent CLI test");};`,
)}`;
function run(args: string[]) {
  const r = spawnSync(process.execPath, ["--import", preload, cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: "test", APP_ORIGIN: "invalid-dry-run-config-must-not-be-read" },
    timeout: 10000, encoding: "utf8",
  });
  assert.equal(r.error, undefined);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(blocked), "CLI must not attempt network in dry-run, invalid args or missing credentials");
  return r;
}
for (const provider of ["max", "telegram"]) {
  it(`${provider} real built menu CLI defaults to a useful dry-run without loading credentials or network`, () => {
    const r = run([`--${provider}`]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"dryRun"\s*:\s*true|"mode"\s*:\s*"dry-run"/u);
    const commands = [...r.stdout.matchAll(/"(?:name|command)"\s*:\s*"([^"]+)"/gu)].map(x => x[1]);
    for (const name of ["start", "menu", "new", "my"]) assert.ok(commands.includes(name), `missing managed command ${name}`);
  });
  it(`${provider} explicit apply without credentials fails closed before any provider fetch`, () => {
    const r = run([`--${provider}`, "--apply"]);
    assert.notEqual(r.status, 0);
    assert.ok(!/installed|registered|успешно установлено/iu.test(r.stdout));
  });
}
it("menu CLI rejects unknown options instead of silently treating them as a dry-run or apply", () => {
  const r = run(["--max", "--arbitrary-option"]);
  assert.notEqual(r.status, 0);
});
it("menu CLI rejects unknown provider before opening any network or reading live bot settings", () => {
  const r = run(["--unknown"]);
  assert.notEqual(r.status, 0);
  assert.notEqual(run(["--max", "--telegram"]).status, 0, "scope must not silently select the last provider");
});
