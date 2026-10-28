(function () {
  "use strict";

  var api = window.TandoorRf;
  var statePanel = document.getElementById("tt-state-panel");

  function showError(message) {
    if (!statePanel) return;
    statePanel.classList.remove("clients-hidden");
    statePanel.textContent = message;
  }

  function hideDemoChrome() {
    document.body.classList.add("tt-lk-mode", "tt-active");
    document.querySelectorAll('[data-tt="demo-settings"], .tt-demo-head-popover, [data-tt="detail-demo"]').forEach(function (el) {
      el.setAttribute("hidden", "hidden");
    });
  }

  async function loadBootstrap() {
    if (!api || !api.fetchJson) {
      showError("Не удалось инициализировать API личного кабинета.");
      return null;
    }
    var res = await api.fetchJson("/api/tan-tracker/bootstrap");
    if (!res.ok) {
      showError(res.error && res.error.message ? res.error.message : "Раздел Тан-трекер недоступен.");
      return null;
    }
    return res.data;
  }

  function applyBootstrap(data) {
    window.__TT_LK_BOOTSTRAP__ = data;
    if (window.TanTrackerPrototype && typeof window.TanTrackerPrototype.hydrateFromServer === "function") {
      window.TanTrackerPrototype.hydrateFromServer(data);
    }
    hideDemoChrome();
    location.hash = location.hash || "#tan-tracker";
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  }

  document.addEventListener("DOMContentLoaded", function () {
    void loadBootstrap().then(function (data) {
      if (data) applyBootstrap(data);
    });
  });
})();
