(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;

  var accessPanel = document.getElementById("access-panel");
  var statePanel = document.getElementById("state-panel");
  var detailEl = document.getElementById("client-detail");
  var backLink = document.getElementById("back-link");
  var copyAddressBtn = document.getElementById("copy-address");
  var copyAddressStatus = document.getElementById("copy-address-status");

  function parseReturnQuery() {
    var params = new URLSearchParams(window.location.search);
    var value = params.get("return") || "";
    if (!value.startsWith("?")) {
      return "";
    }
    return value;
  }

  function clientGuidFromPath() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "clients") {
      return null;
    }
    return decodeURIComponent(parts[1] || "");
  }

  function setCopyStatus(message, kind) {
    copyAddressStatus.textContent = message;
    copyAddressStatus.className = "workspace-status" + (kind ? " workspace-status--" + kind : "");
  }

  function renderPhones(phones) {
    var container = document.getElementById("client-phones");
    if (!phones || phones.length === 0) {
      container.innerHTML = '<p class="clients-phone-muted">Не указан</p>';
      return;
    }
    container.innerHTML = "";
    phones.forEach(function (phone, index) {
      var row = document.createElement("div");
      row.className = "client-detail-phone-row";

      if (phone.telHref) {
        var link = document.createElement("a");
        link.className = "clients-link";
        link.href = "tel:" + phone.telHref;
        link.textContent = phone.value;
        row.appendChild(link);
      } else {
        var text = document.createElement("span");
        text.textContent = phone.value;
        row.appendChild(text);
      }

      var button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-button workspace-button--secondary";
      button.textContent = "Копировать";
      var statusEl = document.createElement("span");
      statusEl.className = "workspace-status copy-phone-status";
      statusEl.id = "copy-phone-" + index;
      statusEl.setAttribute("role", "status");
      statusEl.setAttribute("aria-live", "polite");

      button.addEventListener("click", function () {
        shell
          .copyText(phone.value)
          .then(function () {
            statusEl.textContent = "Скопировано";
            statusEl.className = "workspace-status workspace-status--success";
          })
          .catch(function () {
            statusEl.textContent = "Не удалось скопировать";
            statusEl.className = "workspace-status workspace-status--error";
          });
      });

      row.appendChild(button);
      row.appendChild(statusEl);
      container.appendChild(row);
    });
  }

  function renderClient(client) {
    document.getElementById("client-name").textContent = client.name;
    document.getElementById("client-source").textContent = client.sourceLabel;
    document.getElementById("client-manager").textContent =
      client.manager.name + " · " + client.manager.shortId;
    document.getElementById("client-address").textContent = client.address || "—";
    document.getElementById("client-last-import").textContent =
      "Последняя загрузка этой записи: " + client.lastImportedAtLabel + " (МСК)";
    document.getElementById("client-uuid").textContent = client.guid;

    var holdingEl = document.getElementById("client-holding");
    if (client.holding) {
      holdingEl.innerHTML =
        shell.escapeHtml(client.holding.name) +
        ' · <a class="clients-link clients-link--filter" href="/clients?holding=' +
        encodeURIComponent(client.holding.id) +
        '">' +
        shell.escapeHtml(client.holding.id.slice(0, 8).toUpperCase()) +
        "</a>";
    } else {
      holdingEl.textContent = "—";
    }

    renderPhones(client.phones);
    detailEl.classList.remove("clients-hidden");
    statePanel.classList.add("clients-hidden");
  }

  function showState(title, text) {
    detailEl.classList.add("clients-hidden");
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(statePanel, "info", title, text, "");
  }

  function loadClient(guid) {
    showState("Загрузка карточки…", "");
    return api.apiRequest("/api/clients/" + encodeURIComponent(guid)).then(function (result) {
      if (result.response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (result.response.status === 403) {
        accessPanel.classList.remove("clients-hidden");
        shell.setPanelMessage(
          accessPanel,
          "forbidden",
          "Нет доступа",
          "Раздел доступен только администратору.",
          "",
        );
        return;
      }
      if (result.response.status === 400) {
        showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.");
        return;
      }
      if (result.response.status === 404) {
        showState("Клиент не найден", "Проверьте ссылку или вернитесь к списку.");
        return;
      }
      if (result.response.status === 503) {
        showState(
          "Сервис временно недоступен",
          api.extractErrorMessage(result.data, "Повторите попытку позже."),
        );
        return;
      }
      if (result.response.status !== 200 || !result.data || !result.data.client) {
        showState("Не удалось загрузить карточку", "Повторите попытку позже.");
        return;
      }
      renderClient(result.data.client);
    });
  }

  copyAddressBtn?.addEventListener("click", function () {
    var address = document.getElementById("client-address")?.textContent || "";
    shell
      .copyText(address)
      .then(function () {
        setCopyStatus("Адрес скопирован", "success");
      })
      .catch(function () {
        setCopyStatus("Не удалось скопировать адрес", "error");
      });
  });

  shell.mountShell("clients");
  backLink.href = "/clients" + parseReturnQuery();

  shell.ensureAdminAccess(function (_user, reason) {
    if (reason === "forbidden") {
      accessPanel.classList.remove("clients-hidden");
      shell.setPanelMessage(
        accessPanel,
        "forbidden",
        "Нет доступа",
        "Раздел доступен только администратору.",
        '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
      );
      return;
    }
    var guid = clientGuidFromPath();
    if (!guid) {
      showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.");
      return;
    }
    loadClient(guid).catch(function (err) {
      showState("Ошибка загрузки", api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000));
    });
  });
})();
