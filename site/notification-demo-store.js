(function () {
  "use strict";

  const PATH = "/v1/demo-notification-state";
  let memory = { users: {}, registryPersonal: {} };
  let apiBase = null;
  let apiEnabled = false;
  let hydrated = false;
  let saveStatus = "idle";
  let writeTimer = null;
  let writeChain = Promise.resolve();
  let pendingWrites = 0;
  let statusListeners = [];

  function isLocalOrigin() {
    return /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  }

  function resolveApiBaseFromConfig(cfg, baseURI, hostname) {
    cfg = String(cfg ?? "").trim();
    if (!cfg || cfg === "off" || cfg === "disabled") return null;
    const placeholder = cfg.match(/^__PORT_(\d+)__$/);
    if (placeholder) {
      if (/^(localhost|127\.0\.0\.1)$/i.test(hostname || "")) return `http://127.0.0.1:${placeholder[1]}`;
      return null;
    }
    let href;
    try {
      href = new URL(cfg, baseURI || "http://127.0.0.1/").href;
    } catch {
      return null;
    }
    let u;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const base = (u.origin + u.pathname).replace(/\/$/, "");
    return base || u.origin;
  }

  function resolveApiBase() {
    return resolveApiBaseFromConfig(window.__NOTIFICATION_DEMO_API__, document.baseURI, location.hostname);
  }

  function visitorHeader() {
    if (!isLocalOrigin()) return {};
    const v = window.__NOTIFICATION_DEMO_VISITOR__;
    if (typeof v === "string" && /^[\w.-]{8,128}$/.test(v)) return { "X-Visitor-Id": v };
    return { "X-Visitor-Id": "local-qa-visitor" };
  }

  function setStatus(next) {
    saveStatus = next;
    statusListeners.forEach((fn) => {
      try {
        fn(next);
      } catch {}
    });
  }

  function apiUrl() {
    return apiBase + PATH;
  }

  async function hydrate() {
    apiBase = resolveApiBase();
    apiEnabled = !!apiBase;
    if (!apiEnabled) {
      setStatus("unavailable");
      hydrated = true;
      return { ok: false, unavailable: true };
    }
    try {
      const res = await fetch(apiUrl(), { method: "GET", headers: { ...visitorHeader() } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data && typeof data === "object" && data.users && typeof data.users === "object") {
        memory = {
          users: structuredClone(data.users),
          registryPersonal: data.registryPersonal && typeof data.registryPersonal === "object" ? structuredClone(data.registryPersonal) : {},
        };
      } else memory = { users: {}, registryPersonal: {} };
      setStatus("saved");
      hydrated = true;
      return { ok: true };
    } catch {
      setStatus("unavailable");
      hydrated = true;
      return { ok: false, unavailable: true };
    }
  }

  function loadStore() {
    return structuredClone(memory);
  }

  function saveStore(store) {
    memory = structuredClone(store);
    if (!apiEnabled) {
      setStatus("unavailable");
      return;
    }
    scheduleWrite();
  }

  function markSavedIfIdle() {
    if (!writeTimer && pendingWrites === 0) setStatus("saved");
  }

  function scheduleWrite() {
    setStatus("saving");
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      enqueueWrite();
    }, 40);
  }

  function enqueueWrite() {
    pendingWrites += 1;
    writeChain = writeChain
      .then(async () => {
        const body = JSON.stringify(memory);
        const res = await fetch(apiUrl(), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...visitorHeader() },
          body,
        });
        if (!res.ok) throw new Error(String(res.status));
      })
      .then(() => {
        pendingWrites -= 1;
        markSavedIfIdle();
      })
      .catch(() => {
        pendingWrites -= 1;
        setStatus("failed");
      });
    return writeChain;
  }

  function flush() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
      setStatus("saving");
      enqueueWrite();
    }
    return writeChain;
  }

  async function resetRemote() {
    memory = { users: {}, registryPersonal: {} };
    if (!apiEnabled) {
      setStatus("unavailable");
      return;
    }
    try {
      const res = await fetch(apiUrl(), { method: "DELETE", headers: { ...visitorHeader() } });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  const ready = hydrate();

  window.NotificationDemoStore = {
    ready,
    hydrate,
    flush,
    resetRemote,
    loadStore,
    saveStore,
    getSaveStatus: () => saveStatus,
    getPendingWriteCount: () => pendingWrites,
    isApiEnabled: () => apiEnabled,
    onStatusChange(fn) {
      statusListeners.push(fn);
      return () => {
        statusListeners = statusListeners.filter((x) => x !== fn);
      };
    },
    testResolveApiBase: (cfg, baseURI, hostname) => resolveApiBaseFromConfig(cfg, baseURI, hostname),
  };
})();
