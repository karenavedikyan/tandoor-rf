(function () {
  "use strict";

  var api = window.TandoorRf;

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  function loadExternalBootstrap() {
    var est = qs("est");
    var cap = qs("cap");
    if (!est && !cap) return Promise.resolve(null);
    var q = est ? "est=" + encodeURIComponent(est) : "cap=" + encodeURIComponent(cap);
    return fetch("/api/tan-tracker/public/external/bootstrap?" + q, { credentials: "same-origin" }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error((data && data.error && data.error.message) || "Сессия недоступна.");
        return data;
      });
    });
  }

  function applyExternal(data) {
    window.__TT_EXTERNAL_PERSON__ = true;
    window.__TT_LK_BOOTSTRAP__ = {
      externalPerson: true,
      lkMode: false,
      actorPartyId: data.partyId || null,
      contacts: [
        {
          id: data.partyId || data.personId,
          kind: "external",
          name: data.displayName,
          phone: data.phone,
        },
      ],
      orders: data.orders || [],
      capability: data.capability,
      navAllowed: false,
      previewReadOnly: false,
      prototypeRole: "manager",
    };
    if (window.TanTrackerPrototype && window.TanTrackerPrototype.hydrateFromServer) {
      window.TanTrackerPrototype.hydrateFromServer(window.__TT_LK_BOOTSTRAP__);
    }
    document.body.classList.add("tt-external-shell", "tt-active");
    var host = document.getElementById("tt-root-host");
    if (host) host.classList.remove("clients-hidden");
    if (typeof window.__ttLkRenderTracker === "function") window.__ttLkRenderTracker();
  }

  if (qs("est") || qs("cap")) {
    void loadExternalBootstrap()
      .then(function (data) {
        if (data) applyExternal(data);
      })
      .catch(function (err) {
        var panel = document.getElementById("tt-state-panel");
        if (panel) {
          panel.classList.remove("clients-hidden");
          panel.textContent = (err && err.message) || "Не удалось открыть «Мои передачи».";
        }
      });
  }
})();
