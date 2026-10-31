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

function lifecycle(o: Record<string, unknown>, name = "Карина") {
  const source = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");
  const fn = vm.runInNewContext(`${extractFunctionSource(source, "transferLifecycleContext")}; transferLifecycleContext;`, {
    contactById: (id: string) => id === "missing" ? null : { id, name },
  });
  return fn(o) as ActorCtx;
}

describe("registry lifecycle is independent of viewer role", () => {
  it("completed takes precedence over stale pending and custody hints", () => {
    assert.equal(lifecycle({ status: "completed", pendingId: "p", hasConfirmedReceipt: true }).key, "done");
  });
  it("pending shows exact intended recipient, never moves or replaces current holder", () => {
    const o = { status: "waiting", pendingId: "karina", holderId: "oasis", hasConfirmedReceipt: true };
    const r = lifecycle(o);
    assert.equal(r.key, "waiting");
    assert.equal(r.label, "Ожидает приёма");
    assert.equal(r.hint, "Карина");
    assert.equal(o.holderId, "oasis");
  });
  it("both delivered and canonical intermediate receipt show confirmed", () => {
    assert.equal(lifecycle({ status: "delivered", pendingId: null }).label, "Получение подтверждено");
    assert.equal(lifecycle({ status: "active", hasConfirmedReceipt: true }).key, "received");
  });
  it("new or unproven custody cannot masquerade as receipt using a name or editable note", () => {
    assert.equal(lifecycle({ status: "active", holderId: "other", timeline: [{ note: "Подтверждено одноразовым кодом" }] }).key, "ready");
    assert.equal(lifecycle({ status: "active", hasConfirmedReceipt: false }).label, "Ожидает передачи");
  });
  it("missing recipient is neutral and long names are not shortened by lifecycle logic", () => {
    assert.equal(lifecycle({ status: "waiting", pendingId: "missing" }).hint, "Получатель не указан");
    const name = "Карина Очень Длинная Фамилия <не HTML>";
    assert.equal(lifecycle({ status: "waiting", pendingId: "karina" }, name).hint, name);
  });
  it("standalone handoff mirrors canonical receipt only after a successful transition", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/tan-tracker/tan-tracker.js"), "utf8");
    const complete = vm.runInNewContext(`${extractFunctionSource(source, "completeHandoff")}; completeHandoff;`, {
      state: {}, archiveInvitation: () => {}, resetPhoneIdentity: () => {}, now: () => 100,
    });
    const o = { status: "waiting", holderId: "sender", pendingId: "oasis", finalRecipientId: "karina", timeline: [], hasConfirmedReceipt: false };
    assert.equal(complete(o, "code"), true);
    assert.equal(o.holderId, "oasis");
    assert.equal(o.hasConfirmedReceipt, true);
    assert.equal(lifecycle(o).key, "received");
    assert.equal(complete(o, "code"), false);
    o.pendingId = "karina";
    assert.equal(lifecycle(o).key, "waiting");
    assert.equal(complete(o, "qr"), true);
    assert.equal(o.status, "delivered");
    assert.equal(lifecycle(o).key, "received");
  });
});
