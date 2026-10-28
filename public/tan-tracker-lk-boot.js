(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var statePanel = document.getElementById("tt-state-panel");
  var rootHost = document.getElementById("tt-root-host");

  function showError(message) {
    if (!statePanel) return;
    statePanel.classList.remove("clients-hidden");
    statePanel.textContent = message;
  }

  function hideError() {
    if (statePanel) statePanel.classList.add("clients-hidden");
  }

  function hideDemoChrome() {
    document.body.classList.add("tt-lk-mode", "tt-active");
  }

  function parseBootstrapResponse(result) {
    if (result.response.status === 401) {
      window.location.replace("/login?next=" + encodeURIComponent("/tan-tracker"));
      return null;
    }
    if (result.response.status === 403) {
      showError(api.extractErrorMessage(result.data, "Раздел недоступен для этой роли."));
      return null;
    }
    if (result.response.status !== 200 || !result.data) {
      showError(api.extractErrorMessage(result.data, "Не удалось загрузить Тан-трекер."));
      return null;
    }
    return result.data;
  }

  function loadBootstrap() {
    if (!api || !api.apiRequest) {
      showError("Не удалось инициализировать API личного кабинета.");
      return Promise.resolve(null);
    }
    return api.apiRequest("/api/tan-tracker/bootstrap").then(parseBootstrapResponse);
  }

  function applyBootstrap(data) {
    window.__TT_LK_BOOTSTRAP__ = data;
    hideDemoChrome();
    hideError();
    if (window.TanTrackerPrototype && typeof window.TanTrackerPrototype.hydrateFromServer === "function") {
      window.TanTrackerPrototype.hydrateFromServer(data);
    }
    if (typeof window.__ttLkRenderTracker === "function") {
      window.__ttLkRenderTracker();
    }
  }

  function startTracker(user, reason) {
    if (reason === "forbidden") {
      showError("Раздел недоступен для этой роли.");
      return;
    }
    if (reason) {
      showError("Не удалось загрузить страницу. Повторите позже.");
      return;
    }
    if (!user) {
      return;
    }
    if (rootHost) rootHost.classList.remove("clients-hidden");
    void loadBootstrap().then(function (data) {
      if (data) applyBootstrap(data);
    });
  }

  function mountPage() {
    if (location.pathname.indexOf("/tan-tracker/recipient") >= 0) {
      return;
    }
    if (!shell || !shell.ensureAuthenticated) {
      window.location.replace("/login?next=" + encodeURIComponent("/tan-tracker"));
      return;
    }
    shell.mountAuthenticatedShell("tan-tracker", function (user, reason) {
      startTracker(user, reason);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPage);
  } else {
    mountPage();
  }
})();
