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
    };
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
    return "?" + params.toString();
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
      if (state.v3manager) params.set("managerGuid", state.v3manager);
      if (state.v3type) params.set("typeGuid", state.v3type);
      if (state.v3category) params.set("categoryGuid", state.v3category);
      return api
        .apiRequest("/api/clients/v3/list?" + params.toString(), { signal: ctx.nextListFetchSignal?.() })
        .then(function (result) {
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

    resetFilters: function (ctx) {
      window.ClientsV3.loadList(
        ctx,
        { v3entity: readState().v3entity, page: 1, q: "", closed: "" },
        true,
      );
    },
  };
})();
