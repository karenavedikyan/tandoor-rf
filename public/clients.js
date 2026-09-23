(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var logic = window.ClientsLogic;
  var DEBOUNCE_MS = 300;

  var appEl = document.getElementById("clients-app");
  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var searchInput = document.getElementById("search-input");
  var managerFilter = document.getElementById("manager-filter");
  var managerFilterInput = document.getElementById("manager-filter-input");
  var managerFilterList = document.getElementById("manager-filter-list");
  var holdingFilter = document.getElementById("holding-filter");
  var holdingFilterInput = document.getElementById("holding-filter-input");
  var holdingFilterList = document.getElementById("holding-filter-list");
  var phoneFilter = document.getElementById("phone-filter");
  var resetFiltersBtn = document.getElementById("reset-filters");
  var resultCountEl = document.getElementById("result-count");
  var syncStatusEl = document.getElementById("sync-status");
  var resultsStateEl = document.getElementById("results-state");
  var resultsContentEl = document.getElementById("results-content");
  var tableBody = document.getElementById("clients-table-body");
  var cardsEl = document.getElementById("clients-cards");
  var paginationEl = document.getElementById("pagination");

  var debounceTimer = null;
  var activeRequestId = 0;
  var managerOptions = [];
  var holdingOptions = [];

  function readStateFromUrl() {
    return logic.readStateFromSearch(window.location.search);
  }

  function writeStateToUrl(state, replace) {
    var next = logic.buildListQueryString(state);
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

  function cancelScheduledLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function invalidateInFlightRequests() {
    activeRequestId += 1;
  }

  function applyStateToForm(state) {
    searchInput.value = state.q;
    managerFilter.value = state.manager;
    holdingFilter.value = state.holding;
    phoneFilter.value = state.phone || "all";
    appEl.dataset.page = String(state.page);
    syncComboboxInput("manager", state.manager);
    syncComboboxInput("holding", state.holding);
  }

  function listReturnQuery() {
    return window.location.search || "";
  }

  function clientHref(guid) {
    return "/clients/" + encodeURIComponent(guid) + "?return=" + encodeURIComponent(listReturnQuery());
  }

  function optionLabel(item) {
    return item.name + " · " + item.shortId;
  }

  function syncComboboxInput(kind, selectedId) {
    var input = kind === "manager" ? managerFilterInput : holdingFilterInput;
    var options = kind === "manager" ? managerOptions : holdingOptions;
    if (!selectedId) {
      input.value = "";
      return;
    }
    var match = options.find(function (item) {
      return item.id === selectedId;
    });
    input.value = match ? optionLabel(match) : selectedId.slice(0, 8).toUpperCase();
  }

  function renderComboboxList(kind, query) {
    var listEl = kind === "manager" ? managerFilterList : holdingFilterList;
    var input = kind === "manager" ? managerFilterInput : holdingFilterInput;
    var hidden = kind === "manager" ? managerFilter : holdingFilter;
    var options = kind === "manager" ? managerOptions : holdingOptions;
    var filtered = logic.filterOptions(options, query);

    listEl.innerHTML = "";
    var allOption = document.createElement("li");
    allOption.className = "clients-combobox__option";
    allOption.setAttribute("role", "option");
    allOption.dataset.value = "";
    allOption.textContent = kind === "manager" ? "Все менеджеры" : "Все холдинги";
    listEl.appendChild(allOption);

    filtered.forEach(function (item) {
      var option = document.createElement("li");
      option.className = "clients-combobox__option";
      option.setAttribute("role", "option");
      option.dataset.value = item.id;
      option.textContent = optionLabel(item);
      listEl.appendChild(option);
    });

    var expanded = filtered.length > 0 || query.length > 0 || document.activeElement === input;
    listEl.classList.toggle("clients-hidden", !expanded);
    input.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (hidden.value) {
      input.setAttribute("aria-activedescendant", "");
    }
  }

  function mountCombobox(kind) {
    var input = kind === "manager" ? managerFilterInput : holdingFilterInput;
    var listEl = kind === "manager" ? managerFilterList : holdingFilterList;
    var hidden = kind === "manager" ? managerFilter : holdingFilter;

    input.addEventListener("focus", function () {
      renderComboboxList(kind, input.value);
    });

    input.addEventListener("input", function () {
      hidden.value = "";
      renderComboboxList(kind, input.value);
      invalidateInFlightRequests();
      scheduleLoad(true, true);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        listEl.classList.add("clients-hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    listEl.addEventListener("mousedown", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      var option = target.closest(".clients-combobox__option");
      if (!option) {
        return;
      }
      event.preventDefault();
      hidden.value = option.dataset.value || "";
      syncComboboxInput(kind, hidden.value);
      listEl.classList.add("clients-hidden");
      input.setAttribute("aria-expanded", "false");
      cancelScheduledLoad();
      invalidateInFlightRequests();
      scheduleLoad(true, false);
    });

    document.addEventListener("click", function (event) {
      var combobox = kind === "manager" ? document.getElementById("manager-combobox") : document.getElementById("holding-combobox");
      if (!combobox || combobox.contains(event.target)) {
        return;
      }
      listEl.classList.add("clients-hidden");
      input.setAttribute("aria-expanded", "false");
      syncComboboxInput(kind, hidden.value);
    });
  }

  function showAccessDenied() {
    appEl.classList.add("clients-hidden");
    initPanel.classList.add("clients-hidden");
    accessPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      accessPanel,
      "forbidden",
      "Нет доступа",
      "Раздел доступен только администратору.",
      '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
    );
  }

  function showInitError(title, text) {
    appEl.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    initPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      initPanel,
      "error",
      title,
      text,
      '<button type="button" class="workspace-button workspace-button--primary" id="retry-init">Повторить</button>',
    );
    document.getElementById("retry-init")?.addEventListener("click", function () {
      initializeWorkspace();
    });
  }

  function showAppShell() {
    accessPanel.classList.add("clients-hidden");
    initPanel.classList.add("clients-hidden");
    appEl.classList.remove("clients-hidden");
  }

  function showResultsState(kind, title, text, actionHtml) {
    resultsContentEl.classList.add("clients-hidden");
    paginationEl.classList.add("clients-hidden");
    resultsStateEl.classList.remove("clients-hidden");
    shell.setPanelMessage(resultsStateEl, kind, title, text, actionHtml);
  }

  function showResultsContent() {
    resultsStateEl.classList.add("clients-hidden");
    resultsContentEl.classList.remove("clients-hidden");
    paginationEl.classList.remove("clients-hidden");
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
          (item.holding.id ? renderHoldingCell(item) : "—") +
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
      cancelScheduledLoad();
      invalidateInFlightRequests();
      loadList(Object.assign({}, state, { page: state.page - 1 }), false);
    });
    document.getElementById("page-next")?.addEventListener("click", function () {
      if (state.page >= totalPages) return;
      cancelScheduledLoad();
      invalidateInFlightRequests();
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

  function renderSyncStatus(data) {
    if (!data) {
      syncStatusEl.textContent = "";
      syncStatusEl.className = "clients-sync clients-sync--warning";
      syncStatusEl.textContent = "Не удалось проверить свежесть данных.";
      return;
    }
    var parts = [];
    if (data.runningImport) {
      parts.push("Импорт выполняется…");
    } else if (data.lastSuccessfulImportAtLabel) {
      parts.push("Последняя успешная загрузка из 1С: " + data.lastSuccessfulImportAtLabel + " (МСК)");
    } else {
      parts.push("Успешная загрузка из 1С ещё не выполнялась.");
    }
    syncStatusEl.textContent = parts.join(" ");
    syncStatusEl.className = "clients-sync" + (data.warning ? " clients-sync--warning" : "");
    if (data.warning) {
      syncStatusEl.textContent += " " + data.warning;
    }
  }

  function loadSyncStatus() {
    return api.apiRequest("/api/clients/sync-status").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        renderSyncStatus(null);
        return { ok: false };
      }
      renderSyncStatus(result.data);
      return { ok: true };
    });
  }

  function loadOptions() {
    return api.apiRequest("/api/clients/options").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false, message: api.extractErrorMessage(result.data, "Не удалось загрузить фильтры.") };
      }
      managerOptions = result.data.managers || [];
      holdingOptions = result.data.holdings || [];
      syncComboboxInput("manager", managerFilter.value);
      syncComboboxInput("holding", holdingFilter.value);
      return { ok: true };
    });
  }

  function loadList(state, replaceHistory) {
    cancelScheduledLoad();
    activeRequestId += 1;
    var requestId = activeRequestId;
    applyStateToForm(state);
    writeStateToUrl(state, replaceHistory);
    showAppShell();
    showResultsState("loading", "Загрузка списка…", "", "");

    return api
      .apiRequest("/api/clients?" + buildQueryString(state))
      .then(function (result) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (result.response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (result.response.status === 403) {
          showAccessDenied();
          return;
        }
        if (result.response.status === 503) {
          showResultsState(
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
          showResultsState(
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
          showResultsState(
            "empty-db",
            "База клиентов пуста",
            "После успешного импорта из 1С здесь появится справочник клиентов.",
            "",
          );
          resultCountEl.textContent = "Найдено 0 клиентов";
          return;
        }
        if (result.data.total === 0) {
          showResultsState(
            "empty",
            "Ничего не найдено",
            "Измените поиск или сбросьте фильтры.",
            '<button type="button" class="workspace-button workspace-button--secondary" id="reset-from-empty">Сбросить фильтры</button>',
          );
          resultCountEl.textContent = "Найдено 0 клиентов";
          document.getElementById("reset-from-empty")?.addEventListener("click", function () {
            resetFilters();
          });
          return;
        }

        showResultsContent();
        resultCountEl.textContent = "Найдено " + result.data.total + " клиентов";
        renderRows(result.data.items || []);
        renderPagination(state, result.data.totalPages || 0);
      })
      .catch(function (err) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        showResultsState(
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
    cancelScheduledLoad();
    debounceTimer = setTimeout(function () {
      var state = currentStateFromForm();
      if (resetPage) {
        state.page = 1;
      }
      loadList(state, replaceHistory);
    }, DEBOUNCE_MS);
  }

  function resetFilters() {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    searchInput.value = "";
    managerFilter.value = "";
    holdingFilter.value = "";
    managerFilterInput.value = "";
    holdingFilterInput.value = "";
    phoneFilter.value = "all";
    loadList({ q: "", manager: "", holding: "", phone: "all", page: 1 }, false);
  }

  function initializeWorkspace() {
    showAppShell();
    showResultsState("loading", "Загрузка…", "", "");
    return Promise.all([loadOptions(), loadSyncStatus()])
      .then(function (results) {
        var optionsResult = results[0];
        if (!optionsResult.ok) {
          showInitError(
            "Не удалось загрузить фильтры",
            optionsResult.message || "Повторите попытку позже.",
          );
          return;
        }
        loadList(readStateFromUrl(), true);
      })
      .catch(function (err) {
        showInitError("Ошибка инициализации", api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000));
      });
  }

  searchInput.addEventListener("input", function () {
    invalidateInFlightRequests();
    scheduleLoad(true, true);
  });
  phoneFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  resetFiltersBtn.addEventListener("click", resetFilters);

  window.addEventListener("popstate", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    applyStateToForm(readStateFromUrl());
    loadList(readStateFromUrl(), true);
  });

  mountCombobox("manager");
  mountCombobox("holding");

  shell.mountShell("clients");
  shell.ensureAdminAccess(function (_user, reason) {
    if (reason === "forbidden") {
      showAccessDenied();
      return;
    }
    if (reason === "service") {
      showInitError("Сервис временно недоступен", "Не удалось проверить доступ. Повторите попытку.");
      return;
    }
    if (reason === "network") {
      showInitError("Ошибка сети", "Не удалось связаться с сервером. Проверьте подключение.");
      return;
    }
    initializeWorkspace();
  });
})();
