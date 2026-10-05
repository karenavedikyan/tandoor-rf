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
  var entitySwitcherEl = document.getElementById("entity-switcher");
  var pageTitleEl = document.getElementById("clients-page-title");
  var viewReviewTab = document.getElementById("view-review-tab");
  var viewCompletenessTab = document.getElementById("view-completeness-tab");
  var tableHeadRow = document.getElementById("clients-table-head-row");
  var breadcrumbsEl = document.getElementById("clients-breadcrumbs");
  var teamsPanelEl = document.getElementById("teams-panel");
  var unassignedPanelEl = document.getElementById("unassigned-panel");
  var outletsFilterWrap = document.getElementById("outlets-filter-wrap");
  var outletsFilter = document.getElementById("outlets-filter");
  var outletStatusFilterWrap = document.getElementById("outlet-status-filter-wrap");
  var outletStatusFilter = document.getElementById("outlet-status-filter");
  var warehouseFilterWrap = document.getElementById("warehouse-filter-wrap");
  var warehouseFilter = document.getElementById("warehouse-filter");
  var regionalFilterWrap = document.getElementById("regional-filter-wrap");
  var regionalFilter = document.getElementById("regional-filter");
  var regionalFilterInput = document.getElementById("regional-filter-input");
  var regionalFilterList = document.getElementById("regional-filter-list");
  var tandoorFilterWrap = document.getElementById("tandoor-filter-wrap");
  var tandoorFilter = document.getElementById("tandoor-filter");
  var reviewStateFilterWrap = document.getElementById("review-state-filter-wrap");
  var reviewStateFilter = document.getElementById("review-state-filter");
  var reviewDecisionFilterWrap = document.getElementById("review-decision-filter-wrap");
  var reviewDecisionFilter = document.getElementById("review-decision-filter");
  var unassignedFilterWrap = document.getElementById("unassigned-filter-wrap");
  var unassignedFilter = document.getElementById("unassigned-filter");
  var columnsPickerBtn = document.getElementById("columns-picker-btn");
  var columnsPickerEl = document.getElementById("columns-picker");
  var visibleColumnIds = [];

  var debounceTimer = null;
  var activeRequestId = 0;
  var managerOptions = [];
  var holdingOptions = [];
  var regionalOptions = [];
  var managerCombobox = null;
  var holdingCombobox = null;
  var regionalCombobox = null;
  var currentUser = null;
  var rolePresentation = null;
  var teamContext = {
    director: null,
    rops: [],
    undefinedTeam: [],
    managers: [],
    ropName: "",
    managerName: "",
    limitationNote: "",
  };
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

  function currentEntity() {
    return appEl.dataset.entity || "clients";
  }

  function currentStateFromForm() {
    return {
      view: currentView(),
      entity: currentEntity(),
      q: searchInput.value.trim(),
      manager: managerFilter.value,
      holding: holdingFilter.value,
      phone: phoneFilter.value || "all",
      rop: appEl.dataset.rop || "",
      ropEmployee: appEl.dataset.ropEmployee || "",
      unassignedCategory: unassignedFilter.value || "",
      reviewState: reviewStateFilter.value || "",
      reviewDecision: reviewDecisionFilter.value || "",
      hasOutlets: outletsFilter.value || "all",
      outletStatus: outletStatusFilter.value || "all",
      warehouse: warehouseFilter.value || "all",
      regionalManager: regionalFilter.value || "",
      tandoorClub: tandoorFilter.value.trim(),
      sortBy: appEl.dataset.sortBy || "",
      sortDir: appEl.dataset.sortDir || "",
      cols: appEl.dataset.cols || "",
      page: Number(appEl.dataset.page || "1") || 1,
    };
  }

  function columnsStorageKey(entity) {
    return logic.buildColumnsStorageKey(currentUser && currentUser.id, entity || currentEntity());
  }

  function resolveColumnsForState(state) {
    return logic.resolveVisibleColumns({
      entity: state.entity || "clients",
      view: state.view || "all",
      cols: state.cols || "",
      storageKey: columnsStorageKey(state.entity || "clients"),
    });
  }

  function columnsParamFromIds(columnIds) {
    return columnIds.join(",");
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
    appEl.dataset.entity = state.entity || "clients";
    appEl.dataset.rop = state.rop || "";
    appEl.dataset.ropEmployee = state.ropEmployee || "";
    appEl.dataset.page = String(state.page);
    appEl.dataset.sortBy = state.sortBy || "";
    appEl.dataset.sortDir = state.sortDir || "";
    appEl.dataset.cols = state.cols || "";
    visibleColumnIds = resolveColumnsForState(state);
    searchInput.value = state.q;
    managerFilter.value = state.manager;
    holdingFilter.value = state.holding;
    phoneFilter.value = state.phone || "all";
    outletsFilter.value = state.hasOutlets || "all";
    outletStatusFilter.value = state.outletStatus || "all";
    warehouseFilter.value = state.warehouse || "all";
    regionalFilter.value = state.regionalManager || "";
    tandoorFilter.value = state.tandoorClub || "";
    reviewStateFilter.value = state.reviewState || "";
    reviewDecisionFilter.value = state.reviewDecision || "";
    unassignedFilter.value = state.unassignedCategory || "";
    if (managerCombobox) {
      managerCombobox.syncFromUrl(state.manager);
    }
    if (holdingCombobox) {
      holdingCombobox.syncFromUrl(state.holding);
    }
    if (regionalCombobox) {
      regionalCombobox.syncFromUrl(state.regionalManager || "");
    }
    updateViewSwitcherActive(state.view || "all");
    updateEntitySwitcherActive(state.entity || "clients");
    updateViewChrome(state);
    renderTableHead(state);
  }

  function applyRoleChrome(presentation) {
    rolePresentation = presentation;
    if (!presentation) {
      return;
    }
    if (pageTitleEl) {
      pageTitleEl.textContent = presentation.pageTitle || "Клиенты";
    }
    document.title = (presentation.pageTitle || "Клиенты") + " — tandoor-rf";
    viewSwitcherEl.classList.toggle("clients-hidden", !presentation.showViewSwitcher);
    entitySwitcherEl.classList.toggle(
      "clients-hidden",
      !(presentation.allowedEntities && presentation.allowedEntities.length > 1),
    );
    viewReviewTab.classList.toggle(
      "clients-hidden",
      !(presentation.allowedViews && presentation.allowedViews.indexOf("review") !== -1),
    );
    if (viewCompletenessTab) {
      viewCompletenessTab.classList.toggle(
        "clients-hidden",
        !(presentation.allowedViews && presentation.allowedViews.indexOf("completeness") !== -1),
      );
    }
    document.getElementById("manager-combobox")?.classList.toggle(
      "clients-hidden",
      !presentation.showManagerTeamFilter,
    );
  }

  function loadPresentation() {
    return api.apiRequest("/api/clients/presentation").then(function (result) {
      if (result.response.status === 403) {
        return { ok: false, forbidden: true };
      }
      if (result.response.status !== 200 || !result.data || !result.data.presentation) {
        return {
          ok: false,
          message: api.extractErrorMessage(result.data, "Не удалось определить роль."),
        };
      }
      applyRoleChrome(result.data.presentation);
      return { ok: true, presentation: result.data.presentation };
    });
  }

  function updateEntitySwitcherActive(entity) {
    if (!entitySwitcherEl) {
      return;
    }
    entitySwitcherEl.querySelectorAll("[data-entity]").forEach(function (btn) {
      btn.classList.toggle("clients-view-switcher__btn--active", btn.getAttribute("data-entity") === entity);
    });
  }

  function columnDefById(entity, columnId) {
    return logic.columnDefinitions(entity).find(function (col) {
      return col.id === columnId;
    });
  }

  function renderNoDataCell() {
    return '<span class="clients-no-data">' + shell.escapeHtml(logic.NO_DATA_LABEL) + "</span>";
  }

  function renderTableHead(state) {
    if (!tableHeadRow) {
      return;
    }
    var entity = state.entity || "clients";
    var sortBy = state.sortBy || (entity === "outlets" ? "clientName" : "name");
    var sortDir = state.sortDir || "asc";
    tableHeadRow.innerHTML = visibleColumnIds
      .map(function (columnId) {
        var def = columnDefById(entity, columnId);
        if (!def) {
          return "";
        }
        var sortable = def.sortable && def.hasSource;
        var classes = sortable ? " clients-table__sortable" : "";
        var indicator = sortable ? logic.sortIndicator(sortBy, sortDir, columnId) : "";
        return (
          '<th scope="col" data-column="' +
          shell.escapeHtml(columnId) +
          '"' +
          (sortable ? ' data-sortable="true"' : "") +
          ' class="' +
          classes.trim() +
          '">' +
          shell.escapeHtml(def.label) +
          indicator +
          "</th>"
        );
      })
      .join("");
    tableHeadRow.querySelectorAll("[data-sortable]").forEach(function (th) {
      th.addEventListener("click", function () {
        var columnId = th.getAttribute("data-column") || "";
        var def = columnDefById(entity, columnId);
        if (!def || !def.sortable) {
          return;
        }
        var next = logic.nextSortState(sortBy, sortDir, columnId);
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            sortBy: next.sortBy,
            sortDir: next.sortDir,
            page: 1,
          }),
        );
      });
    });
  }

  function renderClientColumnCell(columnId, item) {
    var def = columnDefById("clients", columnId);
    if (def && !def.hasSource) {
      return renderNoDataCell();
    }
    if (columnId === "name") {
      return (
        '<a class="clients-link" href="' +
        clientHref(item.guid) +
        '">' +
        shell.escapeHtml(item.name) +
        "</a>"
      );
    }
    if (columnId === "holding") {
      return renderHoldingCell(item);
    }
    if (columnId === "manager") {
      return shell.escapeHtml(item.manager.name) + " · " + shell.escapeHtml(item.manager.shortId);
    }
    if (columnId === "team") {
      return renderTeamCell(item);
    }
    if (columnId === "review") {
      return renderReviewCell(item);
    }
    if (columnId === "address") {
      return shell.escapeHtml(item.address || "—");
    }
    if (columnId === "phone") {
      return renderPhonePreview(item.phonePreview);
    }
    if (columnId === "outletsCount") {
      if (item.outletsCount === undefined || item.outletsCount === null) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(String(item.outletsCount));
    }
    if (columnId === "assignmentState") {
      if (!item.teamContext || !item.teamContext.unassignedReason) {
        return '<span class="clients-phone-muted">—</span>';
      }
      return (
        '<span class="clients-tag clients-tag--warn">' +
        shell.escapeHtml(item.teamContext.unassignedReason) +
        "</span>"
      );
    }
    return renderNoDataCell();
  }

  function renderOutletColumnCell(columnId, item) {
    var def = columnDefById("outlets", columnId);
    if (def && !def.hasSource) {
      return renderNoDataCell();
    }
    if (columnId === "clientName") {
      return (
        '<a class="clients-link" href="' +
        clientHref(item.guidClient) +
        '">' +
        shell.escapeHtml(item.clientName) +
        "</a>"
      );
    }
    if (columnId === "outlet") {
      return shell.escapeHtml(item.outletLabel || item.guidStore);
    }
    if (columnId === "guidStore") {
      return shell.escapeHtml(item.guidStore);
    }
    if (columnId === "address") {
      return shell.escapeHtml(item.address || "—");
    }
    if (columnId === "status") {
      return shell.escapeHtml(item.closureStatusLabel || (item.isClosed ? "Закрыта" : "Открыта"));
    }
    if (columnId === "manager") {
      return shell.escapeHtml(item.manager.name) + " · " + shell.escapeHtml(item.manager.shortId);
    }
    if (columnId === "holding") {
      return shell.escapeHtml(item.holdingName || "—");
    }
    if (columnId === "regional") {
      if (!item.regionalManager || !item.regionalManager.hasSource) {
        return renderNoDataCell();
      }
      if (!item.regionalManager.id && !item.regionalManager.name) {
        return '<span class="clients-phone-muted">—</span>';
      }
      var regionalLabel = item.regionalManager.name || item.regionalManager.id;
      if (item.regionalManager.shortId) {
        regionalLabel += " · " + item.regionalManager.shortId;
      }
      return shell.escapeHtml(regionalLabel);
    }
    if (columnId === "warehouse") {
      if (!item.warehouse || !item.warehouse.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.warehouse.label || "—");
    }
    if (columnId === "tandoorClub") {
      if (!item.tandoorClub || !item.tandoorClub.hasSource) {
        return renderNoDataCell();
      }
      if (!item.tandoorClub.value) {
        return '<span class="clients-phone-muted">—</span>';
      }
      return shell.escapeHtml(item.tandoorClub.value);
    }
    return renderNoDataCell();
  }

  function resultCountLabel(total, entity) {
    if (entity === "outlets") {
      return "Найдено " + total + " торговых точек";
    }
    return "Найдено " + total + " клиентов";
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

    regionalCombobox = logic.mountCombobox({
      model: logic.createComboboxModel(),
      input: regionalFilterInput,
      hidden: regionalFilter,
      listEl: regionalFilterList,
      root: document.getElementById("regional-combobox"),
      listboxId: "regional-filter-list",
      allLabel: "Все региональные",
      options: function () {
        return regionalOptions;
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

  function renderOutletRows(items, state) {
    renderTableHead(state);
    tableBody.innerHTML = items
      .map(function (item) {
        return (
          "<tr>" +
          visibleColumnIds
            .map(function (columnId) {
              return "<td>" + renderOutletColumnCell(columnId, item) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = items
      .map(function (item) {
        return (
          '<article class="clients-card">' +
          visibleColumnIds
            .map(function (columnId) {
              var def = columnDefById("outlets", columnId);
              if (!def) {
                return "";
              }
              return (
                '<p class="clients-card__line"><strong>' +
                shell.escapeHtml(def.label) +
                ":</strong> " +
                renderOutletColumnCell(columnId, item) +
                "</p>"
              );
            })
            .join("") +
          "</article>"
        );
      })
      .join("");
  }

  function renderRows(items, state) {
    renderTableHead(state);
    tableBody.innerHTML = items
      .map(function (item) {
        return (
          "<tr>" +
          visibleColumnIds
            .map(function (columnId) {
              return "<td>" + renderClientColumnCell(columnId, item) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = items
      .map(function (item) {
        return (
          '<article class="clients-card">' +
          visibleColumnIds
            .map(function (columnId) {
              var def = columnDefById("clients", columnId);
              if (!def) {
                return "";
              }
              if (columnId === "name") {
                return (
                  '<h2 class="clients-card__title"><a class="clients-link" href="' +
                  clientHref(item.guid) +
                  '">' +
                  shell.escapeHtml(item.name) +
                  "</a></h2>"
                );
              }
              return (
                '<p class="clients-card__line"><strong>' +
                shell.escapeHtml(def.label) +
                ":</strong> " +
                renderClientColumnCell(columnId, item) +
                "</p>"
              );
            })
            .join("") +
          "</article>"
        );
      })
      .join("");
  }

  function renderColumnPicker(state) {
    if (!columnsPickerEl) {
      return;
    }
    var entity = state.entity || "clients";
    var view = state.view || "all";
    var defs = logic.columnDefinitions(entity).filter(function (col) {
      if (!col.viewModes || col.viewModes.length === 0) {
        return true;
      }
      return col.viewModes.indexOf(view) !== -1;
    });
    columnsPickerEl.innerHTML =
      '<div class="clients-columns-picker__grid">' +
      defs
        .map(function (col) {
          var checked = visibleColumnIds.indexOf(col.id) !== -1;
          var disabled = col.locked;
          return (
            '<label class="clients-columns-picker__item' +
            (disabled ? " clients-columns-picker__item--disabled" : "") +
            '">' +
            '<input type="checkbox" data-column-id="' +
            shell.escapeHtml(col.id) +
            '"' +
            (checked ? " checked" : "") +
            (disabled ? " disabled" : "") +
            " />" +
            "<span>" +
            shell.escapeHtml(col.label) +
            (col.hasSource ? "" : " · " + shell.escapeHtml(logic.NO_DATA_LABEL)) +
            "</span>" +
            "</label>"
          );
        })
        .join("") +
      "</div>";
    columnsPickerEl.querySelectorAll("input[type=checkbox]").forEach(function (input) {
      input.addEventListener("change", function () {
        var columnId = input.getAttribute("data-column-id") || "";
        var nextIds = logic.toggleColumnSelection(
          visibleColumnIds,
          columnId,
          input.checked,
          entity,
          view,
        );
        visibleColumnIds = nextIds;
        logic.persistStoredColumnIds(columnsStorageKey(entity), nextIds);
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            cols: columnsParamFromIds(nextIds),
            page: 1,
          }),
        );
      });
    });
  }

  function toggleColumnPicker(state) {
    if (!columnsPickerEl) {
      return;
    }
    var willOpen = columnsPickerEl.classList.contains("clients-hidden");
    if (willOpen) {
      renderColumnPicker(state);
      columnsPickerEl.classList.remove("clients-hidden");
    } else {
      columnsPickerEl.classList.add("clients-hidden");
    }
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
    if (state.entity && state.entity !== "clients") params.set("entity", state.entity);
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.rop) params.set("rop", state.rop);
    if (state.ropEmployee) params.set("ropEmployee", state.ropEmployee);
    if (state.unassignedCategory) params.set("unassignedCategory", state.unassignedCategory);
    if (state.reviewState) params.set("reviewState", state.reviewState);
    if (state.reviewDecision) params.set("reviewDecision", state.reviewDecision);
    if (state.hasOutlets && state.hasOutlets !== "all") params.set("hasOutlets", state.hasOutlets);
    if (state.outletStatus && state.outletStatus !== "all") params.set("outletStatus", state.outletStatus);
    if (state.warehouse && state.warehouse !== "all") params.set("warehouse", state.warehouse);
    if (state.regionalManager) params.set("regionalManager", state.regionalManager);
    if (state.tandoorClub) params.set("tandoorClub", state.tandoorClub);
    if (state.sortBy) params.set("sortBy", state.sortBy);
    if (state.sortDir && state.sortDir !== "asc") params.set("sortDir", state.sortDir);
    if (state.cols) params.set("cols", state.cols);
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
    var isOutlets = (state.entity || "clients") === "outlets";
    outletsFilterWrap.classList.toggle("clients-hidden", state.view === "all");
    outletStatusFilterWrap.classList.toggle("clients-hidden", !isOutlets);
    warehouseFilterWrap.classList.toggle("clients-hidden", !isOutlets);
    regionalFilterWrap.classList.toggle("clients-hidden", !isOutlets);
    tandoorFilterWrap.classList.toggle("clients-hidden", !isOutlets);
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
      if (state.ropEmployee) {
        parts.push({
          label: teamContext.ropName || "РОП",
          href: "/clients?view=teams&ropEmployee=" + encodeURIComponent(state.ropEmployee),
        });
      }
      if (state.manager) {
        parts.push({ label: teamContext.managerName || "Менеджер", href: null });
      }
    } else if (state.view === "completeness") {
      parts.push({ label: "Незаполненные назначения", href: "/clients?view=completeness" });
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

  function renderOrgBadge(label) {
    return label
      ? '<span class="clients-phone-muted clients-team-badge">' + shell.escapeHtml(label) + "</span>"
      : "";
  }

  function renderTeamsPanel(state) {
    if (state.view !== "teams" || state.manager) {
      teamsPanelEl.innerHTML = "";
      return;
    }
    if (!state.ropEmployee) {
      var directorHtml = "";
      if (teamContext.director) {
        directorHtml =
          '<div class="clients-team-director">' +
          "<strong>" +
          shell.escapeHtml(teamContext.director.name) +
          "</strong> · директор" +
          renderOrgBadge(teamContext.director.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
          '<p class="clients-phone-muted">' +
          shell.escapeHtml(teamContext.director.note || "") +
          "</p></div>";
      }
      var undefinedHtml =
        (teamContext.undefinedTeam || []).length > 0
          ? '<div class="clients-team-section"><h3 class="clients-team-section__title">Команда не определена</h3><div class="clients-teams-list">' +
            teamContext.undefinedTeam
              .map(function (member) {
                return (
                  '<div class="clients-team-card clients-team-card--static">' +
                  "<strong>" +
                  shell.escapeHtml(member.name) +
                  "</strong>" +
                  renderOrgBadge(member.rosterPost || "") +
                  renderOrgBadge(member.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
                  "</div>"
                );
              })
              .join("") +
            "</div></div>"
          : "";
      teamsPanelEl.innerHTML =
        directorHtml +
        (teamContext.limitationNote
          ? '<p class="clients-phone-muted">' + shell.escapeHtml(teamContext.limitationNote) + "</p>"
          : "") +
        '<div class="clients-teams-list">' +
        (teamContext.rops || [])
          .map(function (rop) {
            var note = rop.portfolioNote ? " · " + rop.portfolioNote : "";
            return (
              '<button type="button" class="clients-team-card" data-rop-employee="' +
              shell.escapeHtml(rop.employeeGuid) +
              '">' +
              "<strong>" +
              shell.escapeHtml(rop.name) +
              "</strong>" +
              renderOrgBadge(rop.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
              '<span class="clients-phone-muted">' +
              rop.managerCount +
              " ответств. · " +
              rop.uniqueClientCount +
              " клиентов · " +
              rop.uniqueOutletCount +
              " ТТ" +
              shell.escapeHtml(note) +
              "</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>" +
        undefinedHtml;
      teamsPanelEl.querySelectorAll("[data-rop-employee]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ropGuid = btn.getAttribute("data-rop-employee");
          var match = (teamContext.rops || []).find(function (item) {
            return item.employeeGuid === ropGuid;
          });
          teamContext.ropName = match ? match.name : "";
          navigateState({ view: "teams", ropEmployee: ropGuid, rop: "", manager: "", page: 1 });
        });
      });
      return;
    }
    teamsPanelEl.innerHTML =
      '<div class="clients-teams-list">' +
      (teamContext.managers || [])
        .map(function (manager) {
          var kindLabel =
            manager.kind === "regional"
              ? "Региональный"
              : manager.kind === "hardware"
                ? "Менеджер по фурнитуре"
                : "Менеджер";
          return (
            '<button type="button" class="clients-team-card" data-manager="' +
            shell.escapeHtml(manager.employeeGuid) +
            '">' +
            "<strong>" +
            shell.escapeHtml(manager.name) +
            " · " +
            shell.escapeHtml(manager.shortId) +
            "</strong>" +
            renderOrgBadge(kindLabel) +
            renderOrgBadge(manager.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
            renderOrgBadge(manager.rosterInOpt === false ? "Вне справочника ОПТ" : "") +
            '<span class="clients-phone-muted">' +
            manager.clientCount +
            " клиентов · " +
            manager.outletCount +
            " ТТ</span>" +
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
          ropEmployee: state.ropEmployee,
          rop: "",
          manager: managerGuid,
          page: 1,
        });
      });
    });
  }

  function renderCompletenessRows(items) {
    tableBody.innerHTML = (items || [])
      .map(function (item) {
        var cardHref =
          item.entityKind === "outlet" && item.guidStore
            ? "/clients/" +
              encodeURIComponent(item.guidClient) +
              "?store=" +
              encodeURIComponent(item.guidStore)
            : "/clients/" + encodeURIComponent(item.guidClient);
        var entityLabel = item.entityKind === "outlet" ? "ТТ" : "Клиент";
        return (
          "<tr>" +
          "<td>" +
          shell.escapeHtml(entityLabel) +
          "</td>" +
          '<td><a class="clients-link" href="' +
          cardHref +
          '">' +
          shell.escapeHtml(item.name) +
          "</a></td>" +
          "<td>" +
          shell.escapeHtml(item.address || "—") +
          "</td>" +
          "<td>" +
          shell.escapeHtml((item.reasonLabels || []).join("; ")) +
          "</td>" +
          "<td>" +
          shell.escapeHtml(item.lastImportedAtLabel || "—") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
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
    if (!state.ropEmployee) {
      requests.push(
        api.apiRequest("/api/clients/org-structure").then(function (result) {
          if (result.response.status === 200 && result.data) {
            teamContext.director = result.data.director || null;
            teamContext.rops = result.data.rops || [];
            teamContext.undefinedTeam = result.data.undefinedTeam || [];
            teamContext.limitationNote = result.data.limitationNote || "";
          }
          return result.response.status === 200;
        }),
      );
    } else if (!state.manager) {
      requests.push(
        api
          .apiRequest(
            "/api/clients/org-structure/" + encodeURIComponent(state.ropEmployee) + "/responsibles",
          )
          .then(function (result) {
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

  function loadCompletenessQueue(state) {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.ropEmployee) params.set("ropEmployee", state.ropEmployee);
    params.set("page", String(state.page || 1));
    params.set("pageSize", "50");
    return api.apiRequest("/api/clients/completeness-queue?" + params.toString()).then(function (result) {
      return {
        ok: result.response.status === 200,
        data: result.data,
        status: result.response.status,
        error: result.data,
      };
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
      regionalOptions = result.data.regionalManagers || [];
      if (managerCombobox) {
        managerCombobox.syncFromUrl(managerFilter.value);
      }
      if (holdingCombobox) {
        holdingCombobox.syncFromUrl(holdingFilter.value);
      }
      if (regionalCombobox) {
        regionalCombobox.syncFromUrl(regionalFilter.value);
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
          state.ropEmployee ? "Выберите ответственного" : "Выберите РОП",
          "Клиенты загружаются после выбора ответственного в ветке РОП.",
          "",
        );
        resultCountEl.textContent = state.ropEmployee ? "Ответственные РОП" : "Структура по назначениям 1С";
      });
    }

    if (state.view === "completeness") {
      showResultsState("loading", "Загрузка очереди…", "", "");
      updateViewChrome(state);
      return loadCompletenessQueue(state).then(function (result) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (!result.ok) {
          showResultsState(
            "error",
            "Не удалось загрузить очередь",
            api.extractErrorMessage(result.error, "Повторите попытку."),
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        var data = result.data || { items: [], total: 0, totalPages: 0 };
        if (!data.total) {
          showResultsState(
            "empty",
            "Нет записей с выбранными условиями",
            "Измените фильтры или дождитесь следующего импорта из 1С.",
            "",
          );
          resultCountEl.textContent = "0 записей в очереди";
          return;
        }
        showResultsContent();
        tableHeadRow.innerHTML =
          "<th>Тип</th><th>Название</th><th>Адрес</th><th>Причины</th><th>Импорт</th>";
        renderCompletenessRows(data.items || []);
        cardsEl.innerHTML = "";
        resultCountEl.textContent = data.total + " записей в очереди";
        renderPagination(state, data.totalPages || 0);
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
          resultCountEl.textContent = resultCountLabel(0, state.entity || "clients");
          return;
        }
        if (result.data.total === 0) {
          showResultsState(
            "empty",
            "Ничего не найдено",
            "Измените поиск или сбросьте фильтры.",
            '<button type="button" class="workspace-button workspace-button--secondary" id="reset-from-empty">Сбросить фильтры</button>',
          );
          resultCountEl.textContent = resultCountLabel(0, state.entity || "clients");
          document.getElementById("reset-from-empty")?.addEventListener("click", function () {
            resetFilters();
          });
          return;
        }

        showResultsContent();
        resultCountEl.textContent = resultCountLabel(result.data.total, state.entity || "clients");
        if ((state.entity || "clients") === "outlets") {
          renderOutletRows(result.data.items || [], state);
        } else {
          renderRows(result.data.items || [], state);
        }
        renderColumnPicker(state);
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
    if (regionalCombobox) {
      regionalCombobox.reset();
    }
    outletStatusFilter.value = "all";
    warehouseFilter.value = "all";
    tandoorFilter.value = "";
    loadList({
      view: currentView(),
      entity: currentEntity(),
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      ropEmployee: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      hasOutlets: "all",
      outletStatus: "all",
      warehouse: "all",
      regionalManager: "",
      tandoorClub: "",
      sortBy: "",
      sortDir: "",
      cols: "",
      page: 1,
    }, false);
  }

  function switchView(view) {
    if (
      rolePresentation &&
      rolePresentation.allowedViews &&
      rolePresentation.allowedViews.indexOf(view) === -1
    ) {
      return;
    }
    navigateState({
      view: view,
      entity: currentEntity(),
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      ropEmployee: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      hasOutlets: "all",
      page: 1,
    });
  }

  function switchEntity(entity) {
    if (
      rolePresentation &&
      rolePresentation.allowedEntities &&
      rolePresentation.allowedEntities.indexOf(entity) === -1
    ) {
      return;
    }
    var previousEntity = currentEntity();
    var nextState = logic.normalizeStateForEntitySwitch(
      Object.assign({}, currentStateFromForm(), { entity: entity }),
      previousEntity,
    );
    navigateState(nextState);
  }

  function initializeWorkspace() {
    showAppShell();
    showResultsState("loading", "Загрузка…", "", "");
    return loadPresentation()
      .then(function (presentationResult) {
        if (presentationResult.forbidden) {
          showAccessDenied();
          return null;
        }
        if (!presentationResult.ok) {
          showInitError(
            "Не удалось определить роль",
            presentationResult.message || "Повторите попытку позже.",
          );
          return null;
        }
        return Promise.all([loadOptions(), loadSyncStatus()]);
      })
      .then(function (results) {
        if (!results) {
          return;
        }
        var optionsResult = results[0];
        if (!optionsResult.ok) {
          showInitError(
            "Не удалось загрузить фильтры",
            optionsResult.message || "Повторите попытку позже.",
          );
          return;
        }
        var urlState = readStateFromUrl();
        var initialState = logic.applyPresentationDefaults(
          urlState,
          rolePresentation,
          window.location.search,
        );
        loadList(initialState, true);
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
  outletStatusFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  warehouseFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  tandoorFilter.addEventListener("input", function () {
    invalidateInFlightRequests();
    scheduleLoad(true, true);
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
  entitySwitcherEl.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-entity]");
    if (!btn) return;
    switchEntity(btn.getAttribute("data-entity"));
  });
  resetFiltersBtn.addEventListener("click", resetFilters);
  columnsPickerBtn?.addEventListener("click", function () {
    toggleColumnPicker(currentStateFromForm());
  });

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
    initializeWorkspace();
  });
})();
