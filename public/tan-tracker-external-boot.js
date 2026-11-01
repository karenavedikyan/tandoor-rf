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
        if (!r.ok) {
          var err = new Error((data && data.error && data.error.message) || "Сессия недоступна.");
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function applyExternal(data) {
    window.__TT_EXTERNAL_PERSON__ = true;
    window.__TT_EXTERNAL_CAP__ = data.capability || "";
    window.__TT_LK_BOOTSTRAP__ = data;
    if (!window.__TT_LK_BOOTSTRAP__.lkMode) window.__TT_LK_BOOTSTRAP__.lkMode = true;
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
          panel.setAttribute("role", "alert");
          panel.textContent = err && [401, 403, 404, 410].indexOf(err.status) >= 0
            ? "Ссылка для входа больше не действует. Продолжить передачу по ней нельзя. " +
              "Откройте актуальную ссылку из бота Тандор или попросите её у отправителя. " +
              "Для новой отправки создайте новую передачу."
            : (err && err.message) || "Не удалось открыть «Мои передачи».";
        }
      });
  }
})();
