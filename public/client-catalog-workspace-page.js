(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var logic = window.ClientsLogic;

  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var statePanel = document.getElementById("state-panel");
  var appEl = document.getElementById("catalog-workspace-app");
  var rootEl = document.getElementById("catalog-workspace-root");

  function clientGuidFromPath() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "clients" || parts[2] !== "catalog") return null;
    try {
      return decodeURIComponent(parts[1] || "");
    } catch (_err) {
      return null;
    }
  }

  function hideAll() {
    appEl.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    if (initPanel) initPanel.classList.add("clients-hidden");
  }

  function showState(title, text, retryHtml) {
    hideAll();
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(statePanel, "info", title, text, retryHtml || "");
  }

  function handleAccessReason(reason) {
    hideAll();
    if (reason === "forbidden") {
      accessPanel.classList.remove("clients-hidden");
      shell.setPanelMessage(
        accessPanel,
        "error",
        "Нет доступа",
        "У вас нет прав для просмотра этого клиента.",
        '<a class="workspace-button workspace-button--primary" href="/clients">К списку клиентов</a>',
      );
      return;
    }
    showState(
      "Клиент не найден",
      "Карточка недоступна или была удалена из вашей области.",
      '<a class="workspace-button workspace-button--primary" href="/clients">К списку клиентов</a>',
    );
  }

  function boot() {
    var guid = clientGuidFromPath();
    if (!guid || !api || !window.ClientCatalogWorkspace) {
      showState("Ошибка", "Не удалось открыть каталог.", "");
      return;
    }

    api
      .apiRequest("/api/clients/" + encodeURIComponent(guid))
      .then(function (result) {
        if (result.response.status === 403) {
          handleAccessReason("forbidden");
          return;
        }
        if (result.response.status === 404 || !result.data || !result.data.client) {
          handleAccessReason("not_found");
          return;
        }
        hideAll();
        appEl.classList.remove("clients-hidden");
        var client = result.data.client;
        document.title = "Каталог образцов — " + (client.name || "Клиент");
        window.ClientCatalogWorkspace.mount(rootEl, guid, client);
      })
      .catch(function () {
        showState(
          "Ошибка сети",
          "Не удалось загрузить карточку клиента.",
          '<button type="button" class="workspace-button workspace-button--primary" id="retry-boot">Повторить</button>',
        );
        var btn = document.getElementById("retry-boot");
        if (btn) btn.addEventListener("click", boot);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
