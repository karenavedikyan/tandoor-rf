import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

type ActorCtx = { key: string; label: string; icon: string; hint?: string };

function extractFunctionSource(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m || m.index === undefined) {
    throw new Error(`function ${name} not found`);
  }
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return source.slice(m.index, i);
}

function loadRegistryActorContext(): (o: Record<string, unknown>, actor: string | null | undefined) => ActorCtx {
  const file = path.join(process.cwd(), "public/tan-tracker/tan-tracker.js");
  const source = fs.readFileSync(file, "utf8");
  const fnSource = extractFunctionSource(source, "registryActorContext");
  const script = `${fnSource}; registryActorContext;`;
  const sandbox = {
    contactById: (id: string) => ({ id, name: "Fixture Contact" }),
  };
  return vm.runInNewContext(script, sandbox, { filename: "tan-tracker-registryActorContext.js" }) as (
    o: Record<string, unknown>,
    actor: string | null | undefined,
  ) => ActorCtx;
}

const completedOrder = {
  id: "TT-2026-002",
  status: "completed",
  holderId: "h1",
  pendingId: null,
  finalRecipientId: "f1",
};

describe("tan-tracker registryActorContext completed status", () => {
  it("evaluates completed before missing actor in source order", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"),
      "utf8",
    );
    const fnSource = extractFunctionSource(source, "registryActorContext");
    const completedIdx = fnSource.indexOf('o.status === "completed"');
    const noActorIdx = fnSource.indexOf("if (!actor)");
    assert.ok(completedIdx >= 0);
    assert.ok(noActorIdx >= 0);
    assert.ok(completedIdx < noActorIdx);
  });

  it("returns Завершена without actor, for holder, and for observer", () => {
    const registryActorContext = loadRegistryActorContext();
    for (const actor of [null, undefined, "h1", "other-party"]) {
      const ctx = registryActorContext(completedOrder, actor as string | null | undefined);
      assert.equal(ctx.key, "done");
      assert.equal(ctx.label, "Завершена");
    }
  });

  it("keeps non-completed labels for participants", () => {
    const registryActorContext = loadRegistryActorContext();
    const active = {
      id: "TT-ACTIVE",
      status: "active",
      holderId: "h1",
      pendingId: "p1",
      finalRecipientId: "f1",
    };
    assert.equal(registryActorContext(active, "p1").key, "inbox");
    assert.equal(registryActorContext(active, "h1").key, "wait");
    assert.equal(registryActorContext(active, "observer").key, "route");
    assert.equal(registryActorContext(active, null).key, "route");

    const sendOnly = { ...active, pendingId: null };
    assert.equal(registryActorContext(sendOnly, "h1").key, "send");
  });
});
