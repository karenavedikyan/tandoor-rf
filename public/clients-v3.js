(function () {
  "use strict";

  var ENTITIES = [
    { id: "holdings", label: "Холдинги", detailEntity: "holding" },
    { id: "legal", label: "Юрлица", detailEntity: "legal" },
    { id: "retail", label: "Торговые точки", detailEntity: "retail" },
    { id: "orphan_retail", label: "ТТ без холдинга", detailEntity: "retail" },
  ];

  function entityMeta(id) {
    for (var i = 0; i < ENTITIES.length; i += 1) {
      if (ENTITIES[i].id === id) {
        return ENTITIES[i];
      }
    }
    return ENTITIES[1];
  }

  function readState(search) {
    var params = new URLSearchParams(search || window.location.search);
    var entity = params.get("v3entity") || "legal";
    if (!ENTITIES.some(function (e) { return e.id === entity; })) {
      entity = "legal";
    }
    return {
      v3entity: entity,
      page: Math.max(1, Number(params.get("page") || "1")),
      q: params.get("q") || "",
      closed: params.get("closed") || "",
      v3manager: params.get("v3manager") || "",
      v3type: params.get("v3type") || "",
      v3category: params.get("v3category") || "",
      v3view: params.get("v3view") || "all",
      missingManager: params.get("missingManager") === "1",
    };
  }

  function mergeFromLegacyState(legacy, v3) {
    var next = Object.assign({}, v3);
    var view = legacy.view || "all";
    if (view === "teams") next.v3view = "teams";
    else if (view === "review") next.v3view = "unassigned";
    else next.v3view = "all";
    var kind = legacy.teamKind || "manager";
    var mgr = next.v3manager || "";
    if (!mgr) {
      if (kind === "regional") mgr = legacy.regionalManager || legacy.clientRegionalManager || legacy.outletRegionalManager || "";
      else if (kind === "hardware") mgr = legacy.hardwareManager || legacy.clientHardwareManager || legacy.outletHardwareManager || "";
      else mgr = legacy.manager || legacy.clientManager || legacy.outletManager || "";
    }
    if (mgr) {
      next.v3manager = mgr;
      next.responsibleGuid = mgr;
      next.responsibleKind = kind;
    }
    if (legacy.unassignedCategory === "v3_missing_manager") {
      next.missingManager = true;
    }
    return next;
  }

  function writeState(state, replace) {
    var params = new URLSearchParams(window.location.search);
    params.set("v3mode", "1");
    params.set("v3entity", state.v3entity);
    params.set("page", String(state.page));
    if (state.q) {
      params.set("q", state.q);
    } else {
      params.delete("q");
    }
    if (state.closed) params.set("closed", state.closed);
    else params.delete("closed");
    if (state.v3manager) params.set("v3manager", state.v3manager);
    else params.delete("v3manager");
    if (state.v3type) params.set("v3type", state.v3type);
    else params.delete("v3type");
    if (state.v3category) params.set("v3category", state.v3category);
    else params.delete("v3category");
    if (state.v3view && state.v3view !== "all") params.set("v3view", state.v3view);
    else params.delete("v3view");
    if (state.missingManager) params.set("missingManager", "1");
    else params.delete("missingManager");
    var url = window.location.pathname + "?" + params.toString();
    if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }

  function buildListReturnQuery(state) {
    var s = state || readState();
    var params = new URLSearchParams();
    params.set("v3mode", "1");
    params.set("v3entity", s.v3entity);
    params.set("page", String(s.page || 1));
    if (s.q) params.set("q", s.q);
    if (s.closed) params.set("closed", s.closed);
    if (s.v3manager) params.set("v3manager", s.v3manager);
    if (s.v3type) params.set("v3type", s.v3type);
    if (s.v3category) params.set("v3category", s.v3category);
    if (s.v3view) params.set("v3view", s.v3view);
    if (s.missingManager) params.set("missingManager", "1");
    return "?" + params.toString();
  }

  function fillSelect(shell, selectEl, items, selected) {
    if (!selectEl) return;
    var html = '<option value="">Все</option>';
    (items || []).forEach(function (item) {
      html +=
        '<option value="' +
        shell.escapeHtml(item.guid) +
        '"' +
        (selected === item.guid ? " selected" : "") +
        ">" +
        shell.escapeHtml(item.name + " (" + item.count + ")") +
        "</option>";
    });
    selectEl.innerHTML = html;
  }

  function syncFilterDom(shell, state, options) {
    fillSelect(shell, document.getElementById("v3-manager-filter"), options.managers, state.v3manager);
    fillSelect(shell, document.getElementById("v3-type-filter"), options.types, state.v3type);
    fillSelect(shell, document.getElementById("v3-category-filter"), options.categories, state.v3category);
    var closedEl = document.getElementById("v3-closed-filter");
    if (closedEl) closedEl.value = state.closed || "";
    var closedWrap = document.getElementById("v3-closed-filter-wrap");
    var isRetail = state.v3entity === "retail" || state.v3entity === "orphan_retail";
    closedWrap?.classList.toggle("clients-hidden", !isRetail);
  }

  function detailHref(guid, detailEntity, state) {
    return (
      "/clients/" +
      encodeURIComponent(guid) +
      "?v3Entity=" +
      encodeURIComponent(detailEntity) +
      "&return=" +
      encodeURIComponent(buildListReturnQuery(state))
    );
  }

  window.ClientsV3 = {
    isV3Url: function (search) {
      return new URLSearchParams(search || window.location.search).get("v3mode") === "1";
    },

    mountEntitySwitcher: function (entitySwitcherEl) {
      if (!entitySwitcherEl) {
        return;
      }
      entitySwitcherEl.classList.remove("clients-hidden");
      entitySwitcherEl.innerHTML = ENTITIES.map(function (e) {
        return (
          '<button type="button" class="clients-view-switcher__btn" data-v3entity="' +
          e.id +
          '">' +
          e.label +
          "</button>"
        );
      }).join("");
    },

    bindEntitySwitcher: function (entitySwitcherEl, onSwitch) {
      if (!entitySwitcherEl) {
        return;
      }
      entitySwitcherEl.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-v3entity]");
        if (!btn) {
          return;
        }
        onSwitch(btn.getAttribute("data-v3entity"));
      });
    },

    readState: readState,
    writeState: writeState,

    loadList: function (ctx, state, replaceHistory) {
      var api = ctx.api;
      var shell = ctx.shell;
      writeState(state, replaceHistory);
      ctx.showResultsState("loading", "Загрузка списка…", "", "");
      ctx.entitySwitcherEl?.querySelectorAll("[data-v3entity]").forEach(function (btn) {
        btn.classList.toggle("clients-view-switcher__btn--active", btn.getAttribute("data-v3entity") === state.v3entity);
      });
      var meta = entityMeta(state.v3entity);
      if (ctx.pageTitleEl) {
        ctx.pageTitleEl.textContent = meta.label;
      }
      var params = new URLSearchParams();
      params.set("entity", state.v3entity);
      params.set("page", String(state.page));
      params.set("pageSize", "50");
      if (state.q) {
        params.set("q", state.q);
      }
      if (state.closed === "true" || state.closed === "false") params.set("closed", state.closed);
      if (state.responsibleGuid || state.v3manager) {
        params.set("responsibleGuid", state.responsibleGuid || state.v3manager);
        params.set("responsibleKind", state.responsibleKind || "manager");
        params.set("managerGuid", state.v3manager || state.responsibleGuid);
      }
      if (state.v3type) params.set("typeGuid", state.v3type);
      if (state.v3category) params.set("categoryGuid", state.v3category);
      if (state.missingManager) params.set("missingManager", "true");
      var optionsPromise = api.apiRequest(
        "/api/clients/v3/options?entity=" + encodeURIComponent(state.v3entity),
      );
      return Promise.all([
        optionsPromise,
        api.apiRequest("/api/clients/v3/list?" + params.toString(), { signal: ctx.nextListFetchSignal?.() }),
      ]).then(function (pair) {
        var optionsResult = pair[0];
        var result = pair[1];
        if (optionsResult.response.ok && optionsResult.data) {
          syncFilterDom(shell, state, optionsResult.data);
        }
        return result;
      }).then(function (result) {
          if (result.response.status === 401) {
            window.location.replace("/login");
            return;
          }
          if (result.response.status === 403) {
            ctx.showAccessDenied();
            return;
          }
          if (!result.response.ok) {
            ctx.showResultsState(
              "error",
              "Не удалось загрузить список",
              api.extractErrorMessage(result.data, "Повторите попытку."),
              '<button type="button" class="workspace-button workspace-button--primary" id="v3-retry-load">Повторить</button>',
            );
            document.getElementById("v3-retry-load")?.addEventListener("click", function () {
              window.ClientsV3.loadList(ctx, state, true);
            });
            return;
          }
          var data = result.data || { items: [], total: 0 };
          var items = data.items || [];
          if (!items.length) {
            ctx.showResultsState(
              "empty",
              "Нет записей",
              "Измените поиск или фильтры.",
              "",
            );
            ctx.resultCountEl.textContent = "0 записей";
            ctx.tableBody.innerHTML = "";
            ctx.cardsEl.innerHTML = "";
            ctx.paginationEl.innerHTML = "";
            return;
          }
          ctx.showResultsContent();
          var detailType = meta.detailEntity;
          ctx.tableHeadRow.innerHTML =
            "<th>Название</th><th>Холдинг</th><th>Статус</th>";
          ctx.tableBody.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              var holding = item.holding_guid ? shell.escapeHtml(item.holding_guid.slice(0, 8) + "…") : "—";
              var status = item.closed === true ? "Закрыта" : item.closed === false ? "Открыта" : "—";
              return (
                "<tr><td><a href=\"" +
                href +
                '">' +
                shell.escapeHtml(item.name || item.guid) +
                "</a></td><td>" +
                holding +
                "</td><td>" +
                status +
                "</td></tr>"
              );
            })
            .join("");
          ctx.cardsEl.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              return (
                '<a class="clients-card" href="' +
                href +
                '"><span class="clients-card__title">' +
                shell.escapeHtml(item.name || item.guid) +
                "</span></a>"
              );
            })
            .join("");
          var totalPages = Math.max(1, Math.ceil((data.total || 0) / 50));
          ctx.resultCountEl.textContent = (data.total || 0) + " записей";
          ctx.renderPagination(
            { page: state.page, v3entity: state.v3entity, q: state.q, closed: state.closed },
            totalPages,
          );
        });
    },

    bindFilters: function (ctx, reload) {
      ["v3-manager-filter", "v3-type-filter", "v3-category-filter", "v3-closed-filter"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || el.dataset.v3Bound) return;
        el.dataset.v3Bound = "1";
        el.addEventListener("change", function () {
          var next = readState();
          next.v3manager = document.getElementById("v3-manager-filter")?.value || "";
          next.v3type = document.getElementById("v3-type-filter")?.value || "";
          next.v3category = document.getElementById("v3-category-filter")?.value || "";
          next.closed = document.getElementById("v3-closed-filter")?.value || "";
          next.page = 1;
          next.q = ctx.getSearchQuery ? ctx.getSearchQuery() : next.q;
          reload(next);
        });
      });
    },

    renderUnassignedPanel: function (shell, panelEl, summary, navigate) {
      if (!panelEl || !summary) return;
      var m = summary.missingManager || { total: 0, holdings: 0, legal: 0, retail: 0 };
      panelEl.innerHTML =
        '<p class="clients-unassigned-note">' +
        shell.escapeHtml(summary.limitationNote || "") +
        "</p>" +
        '<div class="clients-unassigned-grid">' +
        '<button type="button" class="clients-team-card" data-v3-unassigned="missing">' +
        "<strong>Без менеджера в 1С</strong>" +
        '<span class="clients-phone-muted">' +
        m.total +
        " объектов (Х:" +
        m.holdings +
        " · Ю:" +
        m.legal +
        " · ТТ:" +
        m.retail +
        ")</span></button></div>";
      panelEl.querySelector("[data-v3-unassigned]")?.addEventListener("click", function () {
        navigate({ unassignedCategory: "v3_missing_manager", manager: "", page: 1 });
      });
    },

    loadOrchestrated: function (ctx, legacyState, replaceHistory, hooks) {
      hooks.showAppShell();
      hooks.updateViewChrome(legacyState);
      window.ClientsV3.bindFilters(ctx, function (nextV3) {
        window.ClientsV3.loadList(ctx, nextV3, true);
      });
      var v3state = mergeFromLegacyState(legacyState, readState());
      v3state.page = legacyState.page || v3state.page || 1;
      v3state.q = hooks.getSearchQuery() || v3state.q;

      var teamsHome =
        legacyState.view === "teams" &&
        !hooks.logic.isBranchPortfolioList(legacyState) &&
        !hooks.logic.hasResponsibleSelection(legacyState);
      if (teamsHome) {
        ctx.showResultsState("loading", "Загрузка команд…", "", "");
        return hooks.loadTeamsContext(legacyState).then(function (teamCtx) {
          if (!hooks.logic.shouldAcceptListResponse(hooks.requestId, hooks.activeRequestId)) return;
          if (!teamCtx.ok) {
            ctx.showResultsState("error", "Не удалось загрузить команду", "Повторите попытку.", "");
            return;
          }
          hooks.renderTeamsPanel(legacyState);
          hooks.updateViewChrome(legacyState);
          ctx.showResultsState(
            "empty",
            legacyState.ropEmployee ? "Выберите ответственного" : "Выберите РОП",
            "Список v3 загрузится после выбора ответственного.",
            "",
          );
        });
      }

      var unassignedPick =
        legacyState.view === "review" &&
        !legacyState.manager &&
        !legacyState.unassignedCategory;
      if (unassignedPick) {
        return ctx.api.apiRequest("/api/clients/v3/unassigned-summary").then(function (result) {
          if (!result.response.ok) {
            ctx.showResultsState("error", "Не удалось загрузить сводку", "", "");
            return;
          }
          window.ClientsV3.renderUnassignedPanel(ctx.shell, hooks.unassignedPanelEl, result.data, function (patch) {
            hooks.navigateState(Object.assign({}, hooks.currentStateFromForm(), patch));
          });
          hooks.updateViewChrome(legacyState);
          ctx.showResultsState("empty", "Нераспределённые назначения", "Выберите категорию.", "");
        });
      }

      if (legacyState.view === "review" && legacyState.unassignedCategory === "v3_missing_manager") {
        v3state.missingManager = true;
      }

      paramsEnsureV3Mode();
      return window.ClientsV3.loadList(ctx, v3state, replaceHistory);
    },

    resetFilters: function (ctx) {
      var entity = readState().v3entity;
      window.ClientsV3.loadList(
        ctx,
        {
          v3entity: entity,
          page: 1,
          q: "",
          closed: "",
          v3manager: "",
          v3type: "",
          v3category: "",
          v3view: readState().v3view,
          missingManager: false,
        },
        true,
      );
    },

    mergeFromLegacyState: mergeFromLegacyState,
  };

  function paramsEnsureV3Mode() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("v3mode") !== "1") {
      params.set("v3mode", "1");
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString());
    }
  }
})();
