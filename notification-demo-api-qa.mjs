#!/usr/bin/env node
import { ensureDemoBackend, releaseDemoBackend } from "./prototype/qa-demo-backend.mjs";

const BASE = "http://127.0.0.1:34113/v1/demo-notification-state";

const demoHandle = await ensureDemoBackend();
const checks = [];
const ok = (v, s) => {
  if (!v) throw new Error("API QA: " + s);
  checks.push(s);
};

try {
  async function req(method, headers, body) {
    const res = await fetch(BASE, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, json, text };
  }

  const v1 = "api-qa-visitor-aaa11111";
  const v2 = "api-qa-visitor-bbb22222";

  await req("DELETE", { "X-Visitor-Id": v1 });
  await req("DELETE", { "X-Visitor-Id": v2 });

  let r = await req("PUT", { "X-Visitor-Id": v1 }, { users: { m1: { read: { "m1:x": true }, delivery: { telegram: { connected: true, label: "@a" }, max: { connected: false, label: "" }, prefs: { tt: true, assign: true, system: true }, lastError: "", lastErrorAt: 0 }, deliveryStatus: {} } } });
  ok(r.status === 200, "PUT accepts valid payload");

  r = await req("GET", { "X-Visitor-Id": v1 });
  ok(r.json?.users?.m1?.read?.["m1:x"] === true, "GET returns saved read flag");

  r = await req("GET", { "X-Visitor-Id": v2 });
  ok(!r.json?.users?.m1, "visitor isolation empty for other id");

  r = await req("PUT", { "X-Visitor-Id": "bad" }, { users: {} });
  ok(r.status === 400, "reject short visitor id");

  r = await req("PUT", { "X-Visitor-Id": v1 }, { nope: true });
  ok(r.status === 400, "reject invalid body shape");

  r = await req("GET", { "X-Visitor-Id": v1 });
  ok(r.json?.users?.m1?.read?.["m1:x"] === true, "invalid PUT did not wipe state");

  const snap = await req("GET", { "X-Visitor-Id": v1 });
  r = await req(
    "PUT",
    { "X-Visitor-Id": v1 },
    {
      users: snap.json?.users,
      registryPersonal: { emp_m1: { removed: ["TT-2026-099"], archived: ["TT-2026-098"] } },
    }
  );
  ok(r.status === 200, "PUT accepts registryPersonal flags");

  const snap2 = await req("GET", { "X-Visitor-Id": v1 });
  ok(snap2.json?.registryPersonal?.emp_m1?.removed?.includes("TT-2026-099"), "GET returns registry personal removed");

  r = await req("GET", {});
  ok(r.status === 200 && r.json?.users !== undefined, "loopback fallback visitor without header");

  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  releaseDemoBackend(demoHandle);
}
