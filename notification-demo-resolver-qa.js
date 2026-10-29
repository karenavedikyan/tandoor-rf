import { readFile } from "fs/promises";
import vm from "vm";
import { join } from "path";

const checks = [];
const ok = (v, s) => {
  if (!v) throw Error("Resolver QA: " + s);
  checks.push(s);
};

const storePath = join(process.cwd(), "site/notification-demo-store.js");
let src = await readFile(storePath, "utf8");
ok(!src.includes("__PORT_34113__"), "store.js contains no deploy token literal");

const deployed = src.replace(/__PORT_34113__/g, "port/34113");
const fnBlock = deployed.match(
  /function resolveApiBaseFromConfig\(cfg, baseURI, hostname\) \{[\s\S]*?\n  \}\n\n  function resolveApiBase/
);
ok(!!fnBlock, "extract resolveApiBaseFromConfig from store source");
const fnOnly = fnBlock[0].replace(/\n  function resolveApiBase[\s\S]*$/, "");
const resolveDeployed = vm.runInNewContext(`${fnOnly}; resolveApiBaseFromConfig`, { URL });

ok(
  resolveDeployed("port/34113", "https://preview.example.com/app/index.html", "preview.example.com") ===
    "https://preview.example.com/app/port/34113",
  "deploy-simulated source resolves rewritten port/34113 on hosted origin"
);
ok(
  resolveDeployed("port/34113", "https://preview.example.com/app/", "preview.example.com") !== null,
  "deploy-simulated source enables API after bundle rewrite"
);

var NOTIFICATION_DEMO_RESOLVER_QA = await (async () => {
  await page.goto("http://127.0.0.1:4317/");
  await page.waitForFunction(() => window.NotificationDemoStore?.testResolveApiBase);
  ok(await page.evaluate(() => window.NotificationDemoStore.isApiEnabled()), "live store isApiEnabled on localhost");
  const resolve = (cfg, base, host) =>
    page.evaluate(
      ([c, b, h]) => window.NotificationDemoStore.testResolveApiBase(c, b, h),
      [cfg, base, host]
    );

  ok(
    (await resolve("port/34113", "https://preview.example.com/app/index.html", "preview.example.com")) ===
      "https://preview.example.com/app/port/34113",
    "deploy relative port/34113 resolves against document.baseURI"
  );
  ok(
    (await resolve("__PORT_34113__", "https://preview.example.com/app/", "preview.example.com")) === null,
    "unresolved hosted placeholder stays disabled"
  );
  ok(
    (await resolve("__PORT_34113__", "http://127.0.0.1:4317/site/index.html", "127.0.0.1")) ===
      "http://127.0.0.1:34113",
    "localhost placeholder still uses 127.0.0.1:34113"
  );
  ok(
    (await resolve("https://preview.example.com/api/notify", "https://preview.example.com/", "preview.example.com")) ===
      "https://preview.example.com/api/notify",
    "absolute https config unchanged"
  );

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(NOTIFICATION_DEMO_RESOLVER_QA, null, 2));
