var NOTIFICATION_DEMO_RESOLVER_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Resolver QA: " + s);
    checks.push(s);
  };
  await page.goto("http://127.0.0.1:4317/");
  await page.waitForFunction(() => window.NotificationDemoStore?.testResolveApiBase);
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
  ok((await resolve("port/34113", "https://preview.example.com/app/", "preview.example.com")) !== null, "relative config enables API base not null");

  return { passed: checks.length, checks };
})();
console.log(JSON.stringify(NOTIFICATION_DEMO_RESOLVER_QA, null, 2));
