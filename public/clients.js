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
  var viewSwitcherEl = document.getElementById("view-switcher");
  var viewReviewTab = document.getElementById("view-review-tab");
  var breadcrumbsEl = document.getElementById("clients-breadcrumbs");
  var teamsPanelEl = document.getElementById("teams-panel");
  var unassignedPanelEl = document.getElementById("unassigned-panel");
  var outletsFilterWrap = document.getElementById("outlets-filter-wrap");
  var outletsFilter = document.getElementById("outlets-filter");
  var reviewStateFilterWrap = document.getElementById("review-state-filter-wrap");
  var reviewStateFilter = document.getElementById("review-state-filter");
  var reviewDecisionFilterWrap = document.getElementById("review-decision-filter-wrap");
  var reviewDecisionFilter = document.getElementById("review-decision-filter");
  var unassignedFilterWrap = document.getElementById("unassigned-filter-wrap");
  var unassignedFilter = document.getElementById("unassigned-filter");
  var teamColHeader = document.querySelector('[data-col="team"]');
  var reviewColHeader = document.querySelector('[data-col="review"]');

  var debounceTimer = null;
  var activeRequestId = 0;
  var managerOptions = [];
  var holdingOptions = [];
  var managerCombobox = null;
  var holdingCombobox = null;
  var currentUser = null;
  var teamContext = { rops: [], managers: [], ropName: "", managerName: "" };
  var unassignedContext = { summary: null, categoryLabel: "", employeeName: "" };

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

  function currentView() {
    return appEl.dataset.view || "all";
  }

  function currentStateFromForm() {
    return {
      view: currentView(),
      q: searchInput.value.trim(),
      manager: managerFilter.value,
      holding: holdingFilter.value,
      phone: phoneFilter.value || "all",
      rop: appEl.dataset.rop || "",
      unassignedCategory: unassignedFilter.value || "",
      reviewState: reviewStateFilter.value || "",
      reviewDecision: reviewDecisionFilter.value || "",
      hasOutlets: outletsFilter.value || "all",
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
    appEl.dataset.view = state.view || "all";
    appEl.dataset.rop = state.rop || "";
    appEl.dataset.page = String(state.page);
    searchInput.value = state.q;
    managerFilter.value = state.manager;
    holdingFilter.value = state.holding;
    phoneFilter.value = state.phone || "all";
    outletsFilter.value = state.hasOutlets || "all";
    reviewStateFilter.value = state.reviewState || "";
    reviewDecisionFilter.value = state.reviewDecision || "";
    unassignedFilter.value = state.unassignedCategory || "";
    if (managerCombobox) {
      managerCombobox.syncFromUrl(state.manager);
    }
    if (holdingCombobox) {
      holdingCombobox.syncFromUrl(state.holding);
    }
    updateViewSwitcherActive(state.view || "all");
    updateViewChrome(state);
  }

  function listReturnQuery() {
    return window.location.search || "";
  }

  function clientHref(guid) {
    return "/clients/" + encodeURIComponent(guid) + "?return=" + encodeURIComponent(listReturnQuery());
  }

  function applyComboboxFilter() {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    var state = currentStateFromForm();
    state.page = 1;
    loadList(state, false);
  }

  function mountFilterComboboxes() {
    managerCombobox = logic.mountCombobox({
      model: logic.createComboboxModel(),
      input: managerFilterInput,
      hidden: managerFilter,
      listEl: managerFilterList,
      root: document.getElementById("manager-combobox"),
      listboxId: "manager-filter-list",
      allLabel: "Все менеджеры",
      options: function () {
        return managerOptions;
      },
      onApplySelection: applyComboboxFilter,
    });

    holdingCombobox = logic.mountCombobox({
      model: logic.createComboboxModel(),
      input: holdingFilterInput,
      hidden: holdingFilter,
      listEl: holdingFilterList,
      root: document.getElementById("holding-combobox"),
      listboxId: "holding-filter-list",
      allLabel: "Все холдинги",
      options: function () {
        return holdingOptions;
      },
      onApplySelection: applyComboboxFilter,
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
      "У вашей роли нет доступа к разделу «Клиенты».",
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
      "</a>"
    );
  }

  function renderTeamCell(item) {
    if (!item.teamContext) {
      return '<span class="clients-phone-muted">—</span>';
    }
    if (item.teamContext.label) {
      return shell.escapeHtml(item.teamContext.label);
    }
    if (item.teamContext.unassignedReason) {
      return '<span class="clients-tag clients-tag--warn">' + shell.escapeHtml(item.teamContext.unassignedReason) + "</span>";
    }
    return '<span class="clients-phone-muted">—</span>';
  }

  function renderReviewCell(item) {
    if (!item.review) {
      return '<span class="clients-phone-muted">Не проверен</span>';
    }
    var html = shell.escapeHtml(item.review.stateLabel || item.review.state);
    if (item.review.decisionLabel) {
      html += '<br><span class="clients-phone-muted">' + shell.escapeHtml(item.review.decisionLabel) + "</span>";
    }
    if (item.review.transferStatus === "proposed") {
      html += '<br><span class="clients-tag">Предложена передача</span>';
    } else if (item.review.transferStatus === "confirmed_in_1c") {
      html += '<br><span class="clients-tag clients-tag--ok">Передан (1С)</span>';
    }
    if (item.review.isStale) {
      html += '<br><span class="clients-tag clients-tag--warn">Устарело</span>';
    }
    return html;
  }

  function showExtendedColumns(mode) {
    var showTeam = mode === "teams" || mode === "review";
    var showReview = mode === "review";
    teamColHeader.classList.toggle("clients-hidden", !showTeam);
    reviewColHeader.classList.toggle("clients-hidden", !showReview);
  }

  function renderRows(items) {
    var view = currentView();
    showExtendedColumns(view);
    tableBody.innerHTML = items
      .map(function (item) {
        var teamCell = view === "teams" || view === "review" ? "<td>" + renderTeamCell(item) + "</td>" : "";
        var reviewCell = view === "review" ? "<td>" + renderReviewCell(item) + "</td>" : "";
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
          teamCell +
          reviewCell +
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
        var extra = "";
        if (view === "teams" || view === "review") {
          extra += '<p class="clients-card__line"><strong>Команда:</strong> ' + renderTeamCell(item) + "</p>";
        }
        if (view === "review") {
          extra += '<p class="clients-card__line"><strong>Ревизия:</strong> ' + renderReviewCell(item) + "</p>";
        }
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
          extra +
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
    if (state.view && state.view !== "all") params.set("view", state.view);
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.rop) params.set("rop", state.rop);
    if (state.unassignedCategory) params.set("unassignedCategory", state.unassignedCategory);
    if (state.reviewState) params.set("reviewState", state.reviewState);
    if (state.reviewDecision) params.set("reviewDecision", state.reviewDecision);
    if (state.hasOutlets && state.hasOutlets !== "all") params.set("hasOutlets", state.hasOutlets);
    params.set("page", String(state.page));
    params.set("pageSize", "50");
    return params.toString();
  }

  function updateViewSwitcherActive(view) {
    viewSwitcherEl.querySelectorAll(".clients-view-switcher__btn").forEach(function (btn) {
      btn.classList.toggle("clients-view-switcher__btn--active", btn.getAttribute("data-view") === view);
    });
  }

  function updateViewChrome(state) {
    var isReview = state.view === "review";
    var isTeams = state.view === "teams";
    outletsFilterWrap.classList.toggle("clients-hidden", state.view === "all");
    reviewStateFilterWrap.classList.toggle("clients-hidden", !isReview);
    reviewDecisionFilterWrap.classList.toggle("clients-hidden", !isReview);
    unassignedFilterWrap.classList.toggle("clients-hidden", !isReview);
    teamsPanelEl.classList.toggle("clients-hidden", !isTeams || Boolean(state.manager));
    var reviewEmployeePick = isReview && Boolean(state.unassignedCategory) && !state.manager;
    unassignedPanelEl.classList.toggle("clients-hidden", !isReview);
    resultsContentEl.classList.toggle(
      "clients-hidden",
      (isTeams && !state.manager) || reviewEmployeePick,
    );
    paginationEl.classList.toggle(
      "clients-hidden",
      (isTeams && !state.manager) || reviewEmployeePick,
    );
    renderBreadcrumbs(state);
  }

  function renderBreadcrumbs(state) {
    if (state.view === "all") {
      breadcrumbsEl.classList.add("clients-hidden");
      breadcrumbsEl.innerHTML = "";
      return;
    }
    var parts = [];
    if (state.view === "teams") {
      parts.push({ label: "По командам", href: "/clients?view=teams" });
      if (state.rop) {
        parts.push({
          label: teamContext.ropName || "РОП",
          href: "/clients?view=teams&rop=" + encodeURIComponent(state.rop),
        });
      }
      if (state.manager) {
        parts.push({ label: teamContext.managerName || "Менеджер", href: null });
      }
    } else if (state.view === "review") {
      parts.push({ label: "Ревизия", href: "/clients?view=review" });
      if (state.unassignedCategory) {
        parts.push({
          label: unassignedContext.categoryLabel || "Категория",
          href:
            "/clients?view=review&unassignedCategory=" + encodeURIComponent(state.unassignedCategory),
        });
      }
      if (state.manager && state.unassignedCategory) {
        parts.push({ label: unassignedContext.employeeName || "Ответственный", href: null });
      }
    }
    breadcrumbsEl.innerHTML = parts
      .map(function (part, index) {
        if (!part.href || index === parts.length - 1) {
          return "<span>" + shell.escapeHtml(part.label) + "</span>";
        }
        return '<a class="clients-link" href="' + part.href + '">' + shell.escapeHtml(part.label) + "</a>";
      })
      .join(' <span aria-hidden="true">›</span> ');
    breadcrumbsEl.classList.remove("clients-hidden");
  }

  function renderTeamsPanel(state) {
    if (state.view !== "teams" || state.manager) {
      teamsPanelEl.innerHTML = "";
      return;
    }
    if (!state.rop) {
      teamsPanelEl.innerHTML =
        '<div class="clients-teams-list">' +
        (teamContext.rops || [])
          .map(function (rop) {
            return (
              '<button type="button" class="clients-team-card" data-rop="' +
              shell.escapeHtml(rop.ropUserId) +
              '">' +
              "<strong>" +
              shell.escapeHtml(rop.ropName) +
              "</strong>" +
              '<span class="clients-phone-muted">' +
              rop.managerCount +
              " менедж. · " +
              rop.uniqueClientCount +
              " клиентов</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>";
      teamsPanelEl.querySelectorAll("[data-rop]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ropId = btn.getAttribute("data-rop");
          var match = (teamContext.rops || []).find(function (item) {
            return item.ropUserId === ropId;
          });
          teamContext.ropName = match ? match.ropName : "";
          navigateState({ view: "teams", rop: ropId, manager: "", page: 1 });
        });
      });
      return;
    }
    teamsPanelEl.innerHTML =
      '<div class="clients-teams-list">' +
      (teamContext.managers || [])
        .map(function (manager) {
          var label =
            manager.kind === "rop_own"
              ? "Собственные клиенты РОП"
              : manager.name + " · " + manager.shortId;
          return (
            '<button type="button" class="clients-team-card" data-manager="' +
            shell.escapeHtml(manager.employeeGuid) +
            '">' +
            "<strong>" +
            shell.escapeHtml(label) +
            "</strong>" +
            '<span class="clients-phone-muted">' +
            manager.clientCount +
            " клиентов</span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>";
    teamsPanelEl.querySelectorAll("[data-manager]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var managerGuid = btn.getAttribute("data-manager");
        var match = (teamContext.managers || []).find(function (item) {
          return item.employeeGuid === managerGuid;
        });
        teamContext.managerName = match ? match.name : "";
        navigateState({
          view: "teams",
          rop: state.rop,
          manager: managerGuid,
          page: 1,
        });
      });
    });
  }

  function renderUnassignedPanel(summary, state) {
    if (!summary) {
      unassignedPanelEl.innerHTML = "";
      return;
    }
    unassignedContext.summary = summary;

    if (state && state.unassignedCategory && !state.manager) {
      var employees = (summary.employees || []).filter(function (item) {
        return item.category === state.unassignedCategory;
      });
      var categoryMeta = (summary.categories || []).find(function (item) {
        return item.category === state.unassignedCategory;
      });
      unassignedContext.categoryLabel = categoryMeta ? categoryMeta.label : state.unassignedCategory;
      unassignedPanelEl.innerHTML =
        '<p class="clients-unassigned-note">' +
        shell.escapeHtml(unassignedContext.categoryLabel) +
        " · выберите ответственного</p>" +
        '<div class="clients-unassigned-grid">' +
        employees
          .map(function (employee) {
            return (
              '<button type="button" class="clients-team-card" data-employee="' +
              shell.escapeHtml(employee.employeeGuid) +
              '">' +
              "<strong>" +
              shell.escapeHtml(employee.name + " · " + employee.shortId) +
              "</strong>" +
              '<span class="clients-phone-muted">' +
              employee.clientCount +
              " клиентов</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>";
      unassignedPanelEl.querySelectorAll("[data-employee]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var employeeGuid = btn.getAttribute("data-employee") || "";
          var match = employees.find(function (item) {
            return item.employeeGuid === employeeGuid;
          });
          unassignedContext.employeeName = match ? match.name : "";
          navigateState(
            Object.assign({}, currentStateFromForm(), {
              manager: employeeGuid,
              page: 1,
            }),
          );
        });
      });
      return;
    }

    unassignedPanelEl.innerHTML =
      '<p class="clients-unassigned-note">' +
      shell.escapeHtml(summary.limitationNote || "") +
      "</p>" +
      '<div class="clients-unassigned-grid">' +
      (summary.categories || [])
        .map(function (cat) {
          return (
            '<button type="button" class="clients-team-card" data-category="' +
            shell.escapeHtml(cat.category) +
            '">' +
            "<strong>" +
            shell.escapeHtml(cat.label) +
            "</strong>" +
            '<span class="clients-phone-muted">' +
            cat.employeeCount +
            " ответст. · " +
            cat.uniqueClientCount +
            " клиентов</span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>";
    unassignedPanelEl.querySelectorAll("[data-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        unassignedFilter.value = btn.getAttribute("data-category") || "";
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            unassignedCategory: unassignedFilter.value,
            manager: "",
            page: 1,
          }),
        );
      });
    });
  }

  function navigateState(nextState) {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    loadList(nextState, false);
  }

  function loadTeamsContext(state) {
    if (state.view !== "teams") {
      return Promise.resolve({ ok: true });
    }
    var requests = [];
    if (!state.rop) {
      requests.push(
        api.apiRequest("/api/clients/teams").then(function (result) {
          if (result.response.status === 200 && result.data) {
            teamContext.rops = result.data.items || [];
          }
          return result.response.status === 200;
        }),
      );
    } else if (!state.manager) {
      requests.push(
        api.apiRequest("/api/clients/teams/" + encodeURIComponent(state.rop) + "/managers").then(function (result) {
          if (result.response.status === 200 && result.data) {
            teamContext.managers = result.data.items || [];
          }
          return result.response.status === 200;
        }),
      );
    }
    return Promise.all(requests).then(function (results) {
      return { ok: results.every(Boolean) || results.length === 0 };
    });
  }

  function loadUnassignedSummary() {
    return api.apiRequest("/api/clients/unassigned/summary").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false };
      }
      renderUnassignedPanel(result.data, currentStateFromForm());
      if (unassignedFilter.options.length <= 1) {
        (result.data.categories || []).forEach(function (cat) {
          var opt = document.createElement("option");
          opt.value = cat.category;
          opt.textContent = cat.label;
          unassignedFilter.appendChild(opt);
        });
      }
      return { ok: true };
    });
  }

  function loadReviewOptions() {
    return api.apiRequest("/api/clients/review/options").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false };
      }
      if (reviewStateFilter.options.length <= 1) {
        (result.data.states || []).forEach(function (item) {
          var opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.label;
          reviewStateFilter.appendChild(opt);
        });
      }
      if (reviewDecisionFilter.options.length <= 1) {
        (result.data.decisions || []).forEach(function (item) {
          var opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.label;
          reviewDecisionFilter.appendChild(opt);
        });
      }
      return { ok: true };
    });
  }

  function renderSyncStatus(data) {
    var formatted = logic.formatSyncStatusParts(data);
    syncStatusEl.textContent = formatted.text + formatted.appendWarning;
    syncStatusEl.className = "clients-sync" + (formatted.warning ? " clients-sync--warning" : "");
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
      if (managerCombobox) {
        managerCombobox.syncFromUrl(managerFilter.value);
      }
      if (holdingCombobox) {
        holdingCombobox.syncFromUrl(holdingFilter.value);
      }
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

    if (state.view === "review" && state.unassignedCategory && !state.manager) {
      showResultsState("loading", "Загрузка нераспределённых…", "", "");
      return loadUnassignedSummary().then(function (ctx) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (!ctx.ok) {
          showResultsState(
            "error",
            "Не удалось загрузить категорию",
            "Повторите попытку.",
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        renderUnassignedPanel(unassignedContext.summary, state);
        updateViewChrome(state);
        showResultsState(
          "empty",
          "Выберите ответственного",
          "Клиенты загружаются после выбора сотрудника в категории.",
          "",
        );
        resultCountEl.textContent = "Ответственные без команды";
      });
    }

    if (state.view === "teams" && !state.manager) {
      showResultsState("loading", "Загрузка команд…", "", "");
      return loadTeamsContext(state).then(function (ctx) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (!ctx.ok) {
          showResultsState(
            "error",
            "Не удалось загрузить команды",
            "Повторите попытку.",
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        renderTeamsPanel(state);
        showResultsState(
          "empty",
          state.rop ? "Выберите менеджера" : "Выберите РОП",
          "Клиенты загружаются после выбора менеджера команды.",
          "",
        );
        resultCountEl.textContent = state.rop ? "Менеджеры команды" : "Команды продаж";
      });
    }

    showResultsState("loading", "Загрузка списка…", "", "");

    var prelude = Promise.resolve({ ok: true });
    if (state.view === "teams") {
      prelude = loadTeamsContext(state);
    } else if (state.view === "review") {
      prelude = Promise.all([loadUnassignedSummary(), loadReviewOptions()]).then(function (results) {
        return { ok: results.every(function (item) { return item.ok; }) };
      });
    }

    return prelude
      .then(function () {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return null;
        }
        renderTeamsPanel(state);
        renderUnassignedPanel(unassignedContext.summary, state);
        return api.apiRequest("/api/clients?" + buildQueryString(state));
      })
      .then(function (result) {
        if (!result || !result.response) {
          return;
        }
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
    phoneFilter.value = "all";
    if (managerCombobox) {
      managerCombobox.reset();
    }
    if (holdingCombobox) {
      holdingCombobox.reset();
    }
    loadList({
      view: currentView(),
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      hasOutlets: "all",
      page: 1,
    }, false);
  }

  function switchView(view) {
    if (view === "review" && currentUser && currentUser.role !== "admin") {
      return;
    }
    navigateState({
      view: view,
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      hasOutlets: "all",
      page: 1,
    });
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
  outletsFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  reviewStateFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  reviewDecisionFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  unassignedFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  viewSwitcherEl.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-view]");
    if (!btn) return;
    switchView(btn.getAttribute("data-view"));
  });
  resetFiltersBtn.addEventListener("click", resetFilters);

  window.addEventListener("popstate", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    applyStateToForm(readStateFromUrl());
    loadList(readStateFromUrl(), true);
  });

  mountFilterComboboxes();

  shell.mountShell("clients");
  shell.ensureClientsReadAccess(function (user, reason) {
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
    currentUser = user;
    if (user && user.role === "admin") {
      viewReviewTab.classList.remove("clients-hidden");
    }
    initializeWorkspace();
  });
})();
