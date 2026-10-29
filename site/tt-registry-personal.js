(function () {
  "use strict";

  /** Personal registry visibility flags (per visitor + actor), not canonical order data. */
  let cache = {};
  let readyPromise = null;

  function storeApi() {
    return window.NotificationDemoStore;
  }

  function ensureActor(actorId) {
    if (!cache[actorId]) cache[actorId] = { removed: [], archived: [] };
    const rec = cache[actorId];
    if (!Array.isArray(rec.removed)) rec.removed = [];
    if (!Array.isArray(rec.archived)) rec.archived = [];
    return rec;
  }

  function persist() {
    const DS = storeApi();
    if (!DS?.isApiEnabled?.()) return;
    const snap = DS.loadStore();
    snap.registryPersonal = structuredClone(cache);
    DS.saveStore(snap);
  }

  function init() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const DS = storeApi();
        if (!DS) return;
        await DS.ready;
        const snap = DS.loadStore();
        cache =
          snap.registryPersonal && typeof snap.registryPersonal === "object"
            ? structuredClone(snap.registryPersonal)
            : {};
      })();
    }
    return readyPromise;
  }

  function lists(actorId) {
    return ensureActor(actorId);
  }

  function isRemoved(orderId, actorId) {
    return lists(actorId).removed.includes(orderId);
  }

  function isArchived(orderId, actorId) {
    return lists(actorId).archived.includes(orderId);
  }

  function addRemoved(orderId, actorId) {
    const rec = lists(actorId);
    if (!rec.removed.includes(orderId)) rec.removed.push(orderId);
    rec.archived = rec.archived.filter((id) => id !== orderId);
    persist();
  }

  function removeRemoved(orderId, actorId) {
    lists(actorId).removed = lists(actorId).removed.filter((id) => id !== orderId);
    persist();
  }

  function addArchived(orderId, actorId) {
    const rec = lists(actorId);
    if (!rec.archived.includes(orderId)) rec.archived.push(orderId);
    rec.removed = rec.removed.filter((id) => id !== orderId);
    persist();
  }

  function removeArchived(orderId, actorId) {
    lists(actorId).archived = lists(actorId).archived.filter((id) => id !== orderId);
    persist();
  }

  window.TtRegistryPersonal = {
    init,
    ready: () => init(),
    isRemoved,
    isArchived,
    addRemoved,
    removeRemoved,
    addArchived,
    removeArchived,
    counts(actorId) {
      const rec = lists(actorId);
      return { removed: rec.removed.length, archived: rec.archived.length };
    },
    _testReset() {
      cache = {};
    },
  };
})();
