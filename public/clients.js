(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var DEBOUNCE_MS = 300;

  var appEl = document.getElementById("clients-app");
  var accessPanel = document.getElementById("access-panel");
  var statePanel = document.getElementById("state-panel");
  var searchInput = document.getElementById("search-input");
  var managerFilter = document.getElementById("manager-filter");
  var holdingFilter = document.getElementById("holding-filter");
  var phoneFilter = document.getElementById("phone-filter");
  var resetFiltersBtn = document.getElementById("reset-filters");
  var resultCountEl = document.getElementById("result-count");
  var syncStatusEl = document.getElementById("sync-status");
  var tableBody = document.getElementById("clients-table-body");
  var cardsEl = document.getElementById("clients-cards");
  var paginationEl = document.getElementById("pagination");

  var debounceTimer = null;
  var activeRequestId = 0;
  var optionsLoaded = false;

  function readStateFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return {
      q: params.get("q") || "",
      manager: params.get("manager") || "",
      holding: params.get("holding") || "",
      phone: params.get("phone") || "all",
      page: Math.max(1, Number(params.get("page") || "1") || 1),
    };
  }

  function writeStateToUrl(state, replace) {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.page > 1) params.set("page", String(state.page));
    var next = params.toString();
    var url = next ? "/clients?" + next : "/clients";
    if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }

  function currentStateFromForm() {
    return {
      q: searchInput.value.trim(),
      manager: managerFilter.value,
      holding: holdingFilter.value,
      phone: phoneFilter.value || "all",
      page: Number(appEl.dataset.page || "1") || 1,
    };
  }

  function applyStateToForm(state) {
    searchInput.value = state.q;
    managerFilter.value = state.manager;
    holdingFilter.value = state.holding;
    phoneFilter.value = state.phone || "all";
    appEl.dataset.page = String(state.page);
  }

  function listReturnQuery() {
    return window.location.search || "";
  }

  function clientHref(guid) {
    return "/clients/" + encodeURIComponent(guid) + "?return=" + encodeURIComponent(listReturnQuery());
  }

  function fillSelect(select, items, placeholder) {
    select.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    items.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name + " · " + item.shortId;
      select.appendChild(option);
    });
  }

  function hidePanels() {
    accessPanel.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    appEl.classList.add("clients-hidden");
  }

  function showApp() {
    accessPanel.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    appEl.classList.remove("clients-hidden");
  }

  function showState(kind, title, text, actionHtml) {
    appEl.classList.add("clients-hidden");
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(statePanel, kind, title, text, actionHtml);
  }

  function renderPhonePreview(preview) {
    if (!preview || !preview.primary) {
      return '<span class="clients-phone-muted">Не указан</span>';
    }
    var html = shell.escapeHtml(preview.primary);
    if (preview.extraCount > 0) {
      html += ' <span class="clients-phone-muted">ещё ' + preview.extraCount + "</span>";
    }
    return html;
  }

  function renderHoldingCell(item) {
    if (!item.holding.id) {
      return '<span class="clients-phone-muted">—</span>';
    }
    return (
      '<a class="clients-link clients-link--filter" href="/clients?holding=' +
      encodeURIComponent(item.holding.id) +
      '">' +
      shell.escapeHtml(item.holding.name) +
      " · " +
      shell.escapeHtml(item.holding.id.slice(0, 8).toUpperCase()) +
      "</a>"
    );
  }

  function renderRows(items) {
    tableBody.innerHTML = items
      .map(function (item) {
        return (
          "<tr>" +
          '<td><a class="clients-link" href="' +
          clientHref(item.guid) +
          '">' +
          shell.escapeHtml(item.name) +
          "</a></td>" +
          "<td>" +
          renderHoldingCell(item) +
          "</td>" +
          "<td>" +
          shell.escapeHtml(item.manager.name) +
          " · " +
          shell.escapeHtml(item.manager.shortId) +
          "</td>" +
          "<td>" +
          shell.escapeHtml(item.address || "—") +
          "</td>" +
          "<td>" +
          renderPhonePreview(item.phonePreview) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = items
      .map(function (item) {
        return (
          '<article class="clients-card">' +
          '<h2 class="clients-card__title"><a class="clients-link" href="' +
          clientHref(item.guid) +
          '">' +
          shell.escapeHtml(item.name) +
          "</a></h2>" +
          '<p class="clients-card__line"><strong>Холдинг:</strong> ' +
          (item.holding.id
            ? shell.escapeHtml(item.holding.name)
            : "—") +
          "</p>" +
          '<p class="clients-card__line"><strong>Менеджер:</strong> ' +
          shell.escapeHtml(item.manager.name) +
          " · " +
          shell.escapeHtml(item.manager.shortId) +
          "</p>" +
          '<p class="clients-card__line"><strong>Адрес:</strong> ' +
          shell.escapeHtml(item.address || "—") +
          "</p>" +
          '<p class="clients-card__line"><strong>Телефон:</strong> ' +
          renderPhonePreview(item.phonePreview) +
          "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderPagination(state, totalPages) {
    if (totalPages <= 1) {
      paginationEl.innerHTML = "";
      return;
    }
    var prevDisabled = state.page <= 1;
    var nextDisabled = state.page >= totalPages;
    paginationEl.innerHTML =
      '<button type="button" class="workspace-button workspace-button--secondary" id="page-prev"' +
      (prevDisabled ? " disabled" : "") +
      ">Назад</button>" +
      '<span>Страница ' +
      state.page +
      " из " +
      totalPages +
      "</span>" +
      '<button type="button" class="workspace-button workspace-button--secondary" id="page-next"' +
      (nextDisabled ? " disabled" : "") +
      ">Вперёд</button>";

    document.getElementById("page-prev")?.addEventListener("click", function () {
      if (state.page <= 1) return;
      loadList(Object.assign({}, state, { page: state.page - 1 }), false);
    });
    document.getElementById("page-next")?.addEventListener("click", function () {
      if (state.page >= totalPages) return;
      loadList(Object.assign({}, state, { page: state.page + 1 }), false);
    });
  }

  function buildQueryString(state) {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    params.set("page", String(state.page));
    params.set("pageSize", "50");
    return params.toString();
  }

  function loadSyncStatus() {
    return api.apiRequest("/api/clients/sync-status").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        syncStatusEl.textContent = "";
        return;
      }
      var parts = [];
      if (result.data.runningImport) {
        parts.push("Импорт выполняется…");
      } else if (result.data.lastSuccessfulImportAtLabel) {
        parts.push(
          "Последняя успешная загрузка из 1С: " +
            result.data.lastSuccessfulImportAtLabel +
            " (МСК)",
        );
      } else {
        parts.push("Успешная загрузка из 1С ещё не выполнялась.");
      }
      syncStatusEl.textContent = parts.join(" ");
      syncStatusEl.className = "clients-sync" + (result.data.warning ? " clients-sync--warning" : "");
      if (result.data.warning) {
        syncStatusEl.textContent += " " + result.data.warning;
      }
    });
  }

  function loadOptions() {
    if (optionsLoaded) {
      return Promise.resolve();
    }
    return api.apiRequest("/api/clients/options").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return;
      }
      fillSelect(managerFilter, result.data.managers || [], "Все менеджеры");
      fillSelect(holdingFilter, result.data.holdings || [], "Все холдинги");
      optionsLoaded = true;
    });
  }

  function loadList(state, replaceHistory) {
    activeRequestId += 1;
    var requestId = activeRequestId;
    applyStateToForm(state);
    writeStateToUrl(state, replaceHistory);
    showState("loading", "Загрузка списка…", "", "");

    return api
      .apiRequest("/api/clients?" + buildQueryString(state))
      .then(function (result) {
        if (requestId !== activeRequestId) {
          return;
        }
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
          hidePanels();
          return;
        }
        if (result.response.status === 503) {
          showState(
            "error",
            "Сервис временно недоступен",
            api.extractErrorMessage(result.data, "Повторите попытку позже."),
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        if (result.response.status !== 200 || !result.data) {
          showState(
            "error",
            "Не удалось загрузить клиентов",
            api.extractErrorMessage(result.data, "Повторите попытку."),
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }

        if (result.data.isEmptyDatabase) {
          showState(
            "empty-db",
            "База клиентов пуста",
            "После успешного импорта из 1С здесь появится справочник клиентов.",
            "",
          );
          return;
        }
        if (result.data.total === 0) {
          showApp();
          resultCountEl.textContent = "Найдено 0 клиентов";
          tableBody.innerHTML = "";
          cardsEl.innerHTML = "";
          paginationEl.innerHTML = "";
          showState(
            "empty",
            "Ничего не найдено",
            "Измените поиск или сбросьте фильтры.",
            '<button type="button" class="workspace-button workspace-button--secondary" id="reset-from-empty">Сбросить фильтры</button>',
          );
          document.getElementById("reset-from-empty")?.addEventListener("click", function () {
            resetFilters();
          });
          return;
        }

        showApp();
        resultCountEl.textContent = "Найдено " + result.data.total + " клиентов";
        renderRows(result.data.items || []);
        renderPagination(state, result.data.totalPages || 0);
      })
      .catch(function (err) {
        if (requestId !== activeRequestId) {
          return;
        }
        showState(
          "error",
          "Ошибка загрузки",
          api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
        );
        document.getElementById("retry-load")?.addEventListener("click", function () {
          loadList(state, true);
        });
      });
  }

  function scheduleLoad(resetPage, replaceHistory) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var state = currentStateFromForm();
      if (resetPage) {
        state.page = 1;
      }
      loadList(state, replaceHistory);
    }, DEBOUNCE_MS);
  }

  function resetFilters() {
    searchInput.value = "";
    managerFilter.value = "";
    holdingFilter.value = "";
    phoneFilter.value = "all";
    loadList({ q: "", manager: "", holding: "", phone: "all", page: 1 }, false);
  }

  searchInput.addEventListener("input", function () {
    scheduleLoad(true, true);
  });
  managerFilter.addEventListener("change", function () {
    scheduleLoad(true, false);
  });
  holdingFilter.addEventListener("change", function () {
    scheduleLoad(true, false);
  });
  phoneFilter.addEventListener("change", function () {
    scheduleLoad(true, false);
  });
  resetFiltersBtn.addEventListener("click", resetFilters);

  window.addEventListener("popstate", function () {
    loadList(readStateFromUrl(), true);
  });

  shell.mountShell("clients");
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
    Promise.all([loadOptions(), loadSyncStatus()]).then(function () {
      loadList(readStateFromUrl(), true);
    });
  });
})();
