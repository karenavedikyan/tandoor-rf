(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var logic = window.ClientsLogic;
  var sections = window.ClientDetailSections;

  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var statePanel = document.getElementById("state-panel");
  var detailEl = document.getElementById("client-detail");
  var detailRoot = document.getElementById("client-detail-root");

  function parseReturnQuery() {
    return logic.parseReturnQuery(window.location.search);
  }

  function clientGuidFromPath() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "clients") {
      return null;
    }
    try {
      return decodeURIComponent(parts[1] || "");
    } catch (_err) {
      return null;
    }
  }

  function hideAllPanels() {
    detailEl.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    if (initPanel) {
      initPanel.classList.add("clients-hidden");
    }
  }

  function bindRetryButton(buttonId, onRetry) {
    var button = document.getElementById(buttonId);
    if (!button) {
      return;
    }
    button.addEventListener("click", function () {
      button.disabled = true;
      Promise.resolve()
        .then(onRetry)
        .catch(function () {
          /* errors handled by onRetry callbacks */
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  }

  function showInitError(title, text, onRetry) {
    hideAllPanels();
    if (!initPanel) {
      showState(title, text, onRetry);
      return;
    }
    initPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      initPanel,
      "error",
      title,
      text,
      '<button type="button" class="workspace-button workspace-button--primary" id="retry-init">Повторить</button>',
    );
    bindRetryButton("retry-init", onRetry);
  }

  function handleAccessReason(reason, onRetry) {
    hideAllPanels();
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
    if (reason === "service") {
      showInitError("Сервис временно недоступен", "Не удалось проверить доступ. Повторите попытку.", onRetry);
      return;
    }
    showInitError("Ошибка сети", "Не удалось связаться с сервером. Проверьте подключение.", onRetry);
  }

  function setCopyStatus(message, kind) {
    var statusEl = document.getElementById("copy-address-status");
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.className = "workspace-status" + (kind ? " workspace-status--" + kind : "");
  }

  function bindCopyAddress() {
    var copyAddressBtn = document.getElementById("copy-address");
    if (!copyAddressBtn) {
      return;
    }
    copyAddressBtn.addEventListener("click", function () {
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
  }

  function renderPhones(phones) {
    var container = document.getElementById("client-phones");
    if (!container) {
      return;
    }
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

  function renderDetailLayout(returnQuery) {
    if (!detailRoot) {
      return;
    }
    detailRoot.innerHTML = sections.renderAllSections(returnQuery);
    bindCopyAddress();
  }

  function renderClient(client) {
    hideAllPanels();
    var returnQuery = parseReturnQuery();
    renderDetailLayout(returnQuery);

    var headerEl = detailRoot.querySelector(".client-detail-header");
    if (headerEl) {
      headerEl.outerHTML = sections.renderHeader(client, returnQuery, shell.escapeHtml);
    }

    sections.mountTeamSection(document.getElementById("client-team-section"), client, shell.escapeHtml);

    var addressEl = document.getElementById("client-address");
    if (addressEl) {
      addressEl.textContent = client.address || "—";
    }

    var lastImportEl = document.getElementById("client-last-import");
    if (lastImportEl) {
      lastImportEl.textContent = client.lastImportedAtLabel + " (МСК)";
    }

    var uuidEl = document.getElementById("client-uuid");
    if (uuidEl) {
      uuidEl.textContent = client.guid;
    }

    renderPhones(client.phones);
    sections.initCollapsibles(detailRoot);
    detailEl.classList.remove("clients-hidden");
  }

  function showState(title, text, onRetry) {
    hideAllPanels();
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      statePanel,
      "info",
      title,
      text,
      onRetry
        ? '<button type="button" class="workspace-button workspace-button--primary" id="retry-detail">Повторить</button>'
        : "",
    );
    if (onRetry) {
      bindRetryButton("retry-detail", onRetry);
    }
  }

  var detailController = logic.createDetailController({
    parseGuidFromPath: clientGuidFromPath,
    ensureAdminAccess: function (callback) {
      return shell.ensureAdminAccess(callback);
    },
    showInvalidGuid: function () {
      showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.", null);
    },
    showLoading: function () {
      showState("Загрузка карточки…", "", null);
    },
    fetchClient: function (guid) {
      return api.apiRequest("/api/clients/" + encodeURIComponent(guid));
    },
    handleClientResult: function (result) {
      if (result.response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (result.response.status === 403) {
        handleAccessReason("forbidden", function () {
          return detailController.ensureAccessAndLoad();
        });
        return;
      }
      if (result.response.status === 400) {
        showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.", null);
        return;
      }
      if (result.response.status === 404) {
        showState("Клиент не найден", "Проверьте ссылку или вернитесь к списку.", null);
        return;
      }
      if (result.response.status === 503) {
        showState(
          "Сервис временно недоступен",
          api.extractErrorMessage(result.data, "Повторите попытку позже."),
          function () {
            return detailController.loadClient();
          },
        );
        return;
      }
      if (result.response.status !== 200 || !result.data || !result.data.client) {
        showState("Не удалось загрузить карточку", "Повторите попытку позже.", function () {
          return detailController.loadClient();
        });
        return;
      }
      renderClient(result.data.client);
    },
    showClientError: function (err, onRetry) {
      showState("Ошибка загрузки", api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000), onRetry);
    },
    showInitError: function (err, onRetry) {
      showInitError(
        "Ошибка инициализации",
        api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
        onRetry,
      );
    },
    handleAccessReason: function (reason, onRetry) {
      handleAccessReason(reason, onRetry);
    },
  });

  shell.mountShell("clients", { showClients: true });
  detailController.bootstrap();
})();
