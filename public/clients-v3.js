(function () {
  "use strict";

  var ENTITIES = [
    { id: "holdings", label: "Холдинги", detailEntity: "holding", listNoun: "холдингов" },
    { id: "legal", label: "Клиенты", detailEntity: "legal", listNoun: "клиентов" },
    { id: "retail", label: "Торговые точки", detailEntity: "retail", listNoun: "торговых точек" },
    { id: "orphan_retail", label: "ТТ без холдинга", detailEntity: "retail", listNoun: "торговых точек" },
  ];

  function parseTokenList(raw) {
    if (!raw) {
      return [];
    }
    return String(raw)
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function joinTokenList(tokens) {
    return (tokens || []).filter(Boolean).join(",");
  }

  function entityMeta(id) {
    for (var i = 0; i < ENTITIES.length; i += 1) {
      if (ENTITIES[i].id === id) {
        return ENTITIES[i];
      }
    }
    return ENTITIES[1];
  }

  function normalizeResponsibleKind(value) {
    if (value === "manager" || value === "regional" || value === "hardware") {
      return value;
    }
    return "";
  }

  function isV3TeamAssignment(state) {
    return Boolean(
      state &&
        state.responsibleGuid &&
        state.responsibleKind &&
        (state.v3view === "teams" || state.ropEmployee),
    );
  }

  function readState(search) {
    var params = new URLSearchParams(search || window.location.search);
    var entity = params.get("v3entity") || "legal";
    if (!ENTITIES.some(function (e) { return e.id === entity; })) {
      entity = "legal";
    }
    var responsibleKind =
      normalizeResponsibleKind(params.get("responsibleKind") || "") ||
      normalizeResponsibleKind(params.get("teamKind") || "") ||
      "manager";
    var responsibleGuid = params.get("responsibleGuid") || "";
    if (!responsibleGuid && responsibleKind === "manager") {
      responsibleGuid = params.get("v3manager") || "";
    }
    return {
      v3entity: entity,
      page: Math.max(1, Number(params.get("page") || "1")),
      q: params.get("q") || "",
      closed: params.get("closed") || "",
      v3manager: params.get("v3manager") || "",
      v3type: params.get("v3type") || "",
      v3category: params.get("v3category") || "",
      v3types: parseTokenList(params.get("typeGuids") || params.get("v3type") || ""),
      v3categories: parseTokenList(params.get("categoryGuids") || params.get("v3category") || ""),
      v3view: params.get("v3view") || "all",
      missingManager: params.get("missingManager") === "1",
      ropEmployee: params.get("ropEmployee") || "",
      responsibleGuid: responsibleGuid,
      responsibleKind: responsibleGuid ? responsibleKind : "",
      pageSize: Math.min(100, Math.max(1, Number(params.get("v3pageSize") || "50") || 50)),
    };
  }

  function legacyViewFromV3View(v3view) {
    if (v3view === "teams") return "teams";
    if (v3view === "unassigned") return "review";
    return "all";
  }

  function v3ViewFromLegacyView(view) {
    if (view === "teams") return "teams";
    if (view === "review") return "unassigned";
    return "all";
  }

  function legacyEntityFromV3Entity(v3entity) {
    if (v3entity === "retail" || v3entity === "orphan_retail") return "outlets";
    return "clients";
  }

  function syncLegacyListParams(params, state) {
    var v3view = state.v3view || "all";
    var legacyView = legacyViewFromV3View(v3view);
    params.set("view", legacyView);
    if (v3view !== "all") {
      params.set("v3view", v3view);
    } else {
      params.delete("v3view");
    }
    var legacyEntity = legacyEntityFromV3Entity(state.v3entity || "legal");
    if (legacyEntity === "outlets") {
      params.set("entity", "outlets");
    } else {
      params.delete("entity");
    }
  }

  function readMultiSelectValues(id) {
    var el = document.getElementById(id);
    if (!el) {
      return [];
    }
    if (el.multiple) {
      return Array.from(el.selectedOptions || [])
        .map(function (opt) {
          return opt.value;
        })
        .filter(Boolean);
    }
    return el.value ? [el.value] : [];
  }

  function readFiltersFromDom() {
    var types = readMultiSelectValues("v3-type-filter");
    var categories = readMultiSelectValues("v3-category-filter");
    return {
      v3manager: document.getElementById("v3-manager-filter")?.value || "",
      v3type: types[0] || "",
      v3category: categories[0] || "",
      v3types: types,
      v3categories: categories,
      closed: document.getElementById("v3-closed-filter")?.value || "",
    };
  }

  function v3FilterFallback(key, legacy, fromUrl, urlFilters, domFilters) {
    if (legacy && Object.prototype.hasOwnProperty.call(legacy, key)) {
      return legacy[key] || "";
    }
    if (!fromUrl && domFilters) {
      return domFilters[key] || "";
    }
    return urlFilters[key] || "";
  }

  function mergeListStateForUserAction(patch) {
    var url = readState();
    var dom = readFiltersFromDom();
    var teamResponsible =
      url.responsibleGuid && url.responsibleKind && (url.v3view === "teams" || url.ropEmployee);
    var next = {
      v3entity: url.v3entity,
      v3view: url.v3view,
      page: url.page,
      q: url.q,
      closed: dom.closed || url.closed || "",
      v3manager: teamResponsible
        ? url.responsibleKind === "manager"
          ? url.v3manager || url.responsibleGuid
          : ""
        : dom.v3manager || url.v3manager || "",
      v3type: dom.v3types?.length ? dom.v3types[0] : dom.v3type || url.v3types?.[0] || url.v3type || "",
      v3category: dom.v3categories?.length
        ? dom.v3categories[0]
        : dom.v3category || url.v3categories?.[0] || url.v3category || "",
      v3types: dom.v3types?.length ? dom.v3types : url.v3types || parseTokenList(url.v3type),
      v3categories: dom.v3categories?.length ? dom.v3categories : url.v3categories || parseTokenList(url.v3category),
      missingManager: url.missingManager,
      ropEmployee: url.ropEmployee,
      responsibleGuid: url.responsibleGuid,
      responsibleKind: url.responsibleKind,
      pageSize: url.pageSize || 50,
    };
    if (patch) {
      Object.keys(patch).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          next[key] = patch[key];
        }
      });
    }
    if (next.v3manager) {
      next.responsibleGuid = next.v3manager;
      next.responsibleKind = "manager";
    } else if (patch && Object.prototype.hasOwnProperty.call(patch, "v3manager") && !patch.v3manager) {
      next.responsibleGuid = "";
      next.responsibleKind = "";
    }
    return next;
  }

  function legacyStateToV3(legacy, loadSource) {
    var logic = typeof ClientsLogic !== "undefined" ? ClientsLogic : null;
    var urlFilters = readState();
    var domFilters = loadSource === "url" ? null : readFiltersFromDom();
    var fromUrl = loadSource === "url";
    var view = legacy.view || "all";
    var entity = legacy.entity || "clients";
    var v3entity = logic
      ? logic.mapLegacyEntityToV3Entity(entity, urlFilters.v3entity)
      : entity === "outlets"
        ? "retail"
        : "legal";
    var v3managerVal = logic
      ? logic.legacyStringField(
          legacy,
          "v3manager",
          v3FilterFallback("v3manager", legacy, fromUrl, urlFilters, domFilters),
        )
      : v3FilterFallback("v3manager", legacy, fromUrl, urlFilters, domFilters);
    var assignment = logic
      ? logic.v3ResponsibleFromLegacyState(legacy)
      : { responsibleGuid: "", responsibleKind: "", v3manager: "" };
    var explicitResponsible = logic && logic.hasExplicitResponsibleNavigation(legacy);
    if (explicitResponsible) {
      if (
        Object.prototype.hasOwnProperty.call(legacy || {}, "responsibleGuid") &&
        !legacy.responsibleGuid
      ) {
        assignment = { responsibleGuid: "", responsibleKind: "", v3manager: "" };
      } else if (assignment.responsibleKind && assignment.responsibleKind !== "manager") {
        assignment.v3manager = "";
      }
    } else if (v3managerVal) {
      assignment = {
        responsibleGuid: v3managerVal,
        responsibleKind: "manager",
        v3manager: v3managerVal,
      };
    } else if (
      Object.prototype.hasOwnProperty.call(legacy || {}, "v3manager") &&
      !v3managerVal
    ) {
      assignment = { responsibleGuid: "", responsibleKind: "", v3manager: "" };
    } else if (
      fromUrl &&
      !assignment.responsibleGuid &&
      urlFilters.responsibleGuid &&
      !(logic && logic.hasResponsibleSelection(legacy))
    ) {
      assignment = {
        responsibleGuid: urlFilters.responsibleGuid,
        responsibleKind: urlFilters.responsibleKind || "manager",
        v3manager: urlFilters.v3manager || urlFilters.responsibleGuid,
      };
    } else if (
      !fromUrl &&
      (legacy.view || "all") === "teams" &&
      !assignment.responsibleGuid &&
      urlFilters.responsibleGuid &&
      !v3managerVal &&
      !(logic && logic.hasResponsibleSelection(legacy))
    ) {
      assignment = {
        responsibleGuid: urlFilters.responsibleGuid,
        responsibleKind: urlFilters.responsibleKind || "manager",
        v3manager: urlFilters.v3manager || urlFilters.responsibleGuid,
      };
    }
    var ropEmployee = logic
      ? logic.legacyStringField(
          legacy,
          "ropEmployee",
          v3FilterFallback("ropEmployee", legacy, fromUrl, urlFilters, domFilters),
        )
      : legacy.ropEmployee || (fromUrl ? urlFilters.ropEmployee : "") || "";
    var v3type = logic
      ? logic.legacyStringField(
          legacy,
          "v3type",
          v3FilterFallback("v3type", legacy, fromUrl, urlFilters, domFilters),
        )
      : v3FilterFallback("v3type", legacy, fromUrl, urlFilters, domFilters);
    var v3category = logic
      ? logic.legacyStringField(
          legacy,
          "v3category",
          v3FilterFallback("v3category", legacy, fromUrl, urlFilters, domFilters),
        )
      : v3FilterFallback("v3category", legacy, fromUrl, urlFilters, domFilters);
    var closed = logic
      ? logic.legacyStringField(
          legacy,
          "closed",
          v3FilterFallback("closed", legacy, fromUrl, urlFilters, domFilters),
        )
      : v3FilterFallback("closed", legacy, fromUrl, urlFilters, domFilters);
    return {
      v3entity: v3entity,
      v3view: v3ViewFromLegacyView(view),
      page: legacy.page != null ? legacy.page : fromUrl ? urlFilters.page || 1 : 1,
      q: legacy.q != null ? legacy.q : fromUrl ? urlFilters.q || "" : "",
      closed: closed,
      v3manager: assignment.v3manager,
      v3type: v3type || (urlFilters.v3types && urlFilters.v3types[0]) || "",
      v3category: v3category || (urlFilters.v3categories && urlFilters.v3categories[0]) || "",
      v3types:
        fromUrl && urlFilters.v3types && urlFilters.v3types.length
          ? urlFilters.v3types
          : parseTokenList(v3type),
      v3categories:
        fromUrl && urlFilters.v3categories && urlFilters.v3categories.length
          ? urlFilters.v3categories
          : parseTokenList(v3category),
      missingManager: Boolean(legacy.missingManager) || (fromUrl && urlFilters.missingManager),
      ropEmployee: ropEmployee,
      responsibleGuid: assignment.responsibleGuid,
      responsibleKind: assignment.responsibleKind,
      pageSize: urlFilters.pageSize || 50,
    };
  }

  function mergeFromLegacyState(legacy, v3, loadSource) {
    var next = Object.assign({}, legacyStateToV3(legacy, loadSource), v3 || {});
    if (legacy.unassignedCategory === "v3_missing_manager") {
      next.missingManager = true;
    }
    return next;
  }

  function writeState(state, replace) {
    var params = new URLSearchParams(window.location.search);
    params.set("v3mode", "1");
    params.set("v3entity", state.v3entity);
    syncLegacyListParams(params, state);
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
    params.delete("v3type");
    params.delete("typeGuids");
    if (state.v3types && state.v3types.length > 1) {
      params.set("typeGuids", joinTokenList(state.v3types));
    } else if (state.v3types && state.v3types.length === 1) {
      params.set("v3type", state.v3types[0]);
    } else if (state.v3type) {
      params.set("v3type", state.v3type);
    }
    params.delete("v3category");
    params.delete("categoryGuids");
    if (state.v3categories && state.v3categories.length > 1) {
      params.set("categoryGuids", joinTokenList(state.v3categories));
    } else if (state.v3categories && state.v3categories.length === 1) {
      params.set("v3category", state.v3categories[0]);
    } else if (state.v3category) {
      params.set("v3category", state.v3category);
    }
    if (state.pageSize && state.pageSize !== 50) {
      params.set("v3pageSize", String(state.pageSize));
    } else {
      params.delete("v3pageSize");
    }
    if (state.missingManager) params.set("missingManager", "1");
    else params.delete("missingManager");
    if (state.ropEmployee) params.set("ropEmployee", state.ropEmployee);
    else params.delete("ropEmployee");
    if (state.responsibleGuid) {
      params.set("responsibleGuid", state.responsibleGuid);
      params.set("responsibleKind", state.responsibleKind || "manager");
      params.set("teamKind", state.responsibleKind || "manager");
    } else {
      params.delete("responsibleGuid");
      params.delete("responsibleKind");
      params.delete("teamKind");
    }
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
    syncLegacyListParams(params, s);
    params.set("page", String(s.page || 1));
    if (s.q) params.set("q", s.q);
    if (s.closed) params.set("closed", s.closed);
    if (s.v3manager) params.set("v3manager", s.v3manager);
    if (s.v3types && s.v3types.length > 1) params.set("typeGuids", joinTokenList(s.v3types));
    else if (s.v3types && s.v3types.length === 1) params.set("v3type", s.v3types[0]);
    else if (s.v3type) params.set("v3type", s.v3type);
    if (s.v3categories && s.v3categories.length > 1) params.set("categoryGuids", joinTokenList(s.v3categories));
    else if (s.v3categories && s.v3categories.length === 1) params.set("v3category", s.v3categories[0]);
    else if (s.v3category) params.set("v3category", s.v3category);
    if (s.missingManager) params.set("missingManager", "1");
    if (s.ropEmployee) params.set("ropEmployee", s.ropEmployee);
    if (s.responsibleGuid) {
      params.set("responsibleGuid", s.responsibleGuid);
      params.set("responsibleKind", s.responsibleKind || "manager");
      params.set("teamKind", s.responsibleKind || "manager");
    }
    if (s.pageSize && s.pageSize !== 50) {
      params.set("v3pageSize", String(s.pageSize));
    }
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

  function fillMultiSelect(shell, selectEl, items, selectedGuids) {
    if (!selectEl) return;
    var selected = selectedGuids || [];
    var html = "";
    (items || []).forEach(function (item) {
      html +=
        '<option value="' +
        shell.escapeHtml(item.guid) +
        '"' +
        (selected.indexOf(item.guid) !== -1 ? " selected" : "") +
        ">" +
        shell.escapeHtml(item.name + " (" + item.count + ")") +
        "</option>";
    });
    selectEl.innerHTML = html;
  }

  function syncFilterDom(shell, state, options) {
    fillSelect(shell, document.getElementById("v3-manager-filter"), options.managers, state.v3manager);
    var types = state.v3types && state.v3types.length ? state.v3types : parseTokenList(state.v3type);
    var categories =
      state.v3categories && state.v3categories.length ? state.v3categories : parseTokenList(state.v3category);
    fillMultiSelect(shell, document.getElementById("v3-type-filter"), options.types, types);
    fillMultiSelect(shell, document.getElementById("v3-category-filter"), options.categories, categories);
    var closedEl = document.getElementById("v3-closed-filter");
    if (closedEl) closedEl.value = state.closed || "";
    var closedWrap = document.getElementById("v3-closed-filter-wrap");
    var isRetail = state.v3entity === "retail" || state.v3entity === "orphan_retail";
    closedWrap?.classList.toggle("clients-hidden", !isRetail);
  }

  function v3ListColumns(presentation, v3entity) {
    var role = presentation && presentation.businessRole;
    if (role === "regional_manager" && (v3entity === "retail" || v3entity === "orphan_retail")) {
      return [
        { id: "name", label: "Торговая точка" },
        { id: "store_address", label: "Адрес магазина" },
        { id: "manager_name", label: "Менеджер ТТ" },
        { id: "regional_name", label: "Региональный ТТ" },
        { id: "rop_name", label: "РОП ТТ" },
      ];
    }
    if (role === "manager" || role === "assistant") {
      return [
        { id: "name", label: "Название клиента" },
        { id: "manager_name", label: "Менеджер клиента" },
        { id: "regional_name", label: "Региональный клиента" },
        { id: "hardware_name", label: "По фурнитуре клиента" },
        { id: "rop_name", label: "РОП клиента" },
      ];
    }
    if (v3entity === "retail" || v3entity === "orphan_retail") {
      return [
        { id: "name", label: "Торговая точка" },
        { id: "store_address", label: "Адрес" },
        { id: "manager_name", label: "Менеджер" },
        { id: "regional_name", label: "Региональный" },
        { id: "rop_name", label: "РОП" },
        { id: "closed", label: "Статус" },
      ];
    }
    return [
      { id: "name", label: "Название" },
      { id: "holding", label: "Холдинг" },
      { id: "manager_name", label: "Менеджер" },
      { id: "regional_name", label: "Региональный" },
      { id: "rop_name", label: "РОП" },
    ];
  }

  function v3CellValue(item, col, shell) {
    if (col.id === "holding") {
      if (item.holding_name) {
        return shell.escapeHtml(String(item.holding_name));
      }
      return item.holding_guid ? shell.escapeHtml(item.holding_guid.slice(0, 8) + "…") : "—";
    }
    if (col.id === "closed") {
      if (item.closed === true) return "Закрыта";
      if (item.closed === false) return "Открыта";
      return "—";
    }
    var value = item[col.id];
    return value ? shell.escapeHtml(String(value)) : "—";
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

    mountEntitySwitcher: function (entitySwitcherEl, allowedIds) {
      if (!entitySwitcherEl) {
        return;
      }
      var allowed =
        allowedIds && allowedIds.length
          ? allowedIds
          : ENTITIES.map(function (e) {
              return e.id;
            });
      var visible = ENTITIES.filter(function (e) {
        return allowed.indexOf(e.id) !== -1;
      });
      if (!visible.length) {
        entitySwitcherEl.classList.add("clients-hidden");
        entitySwitcherEl.innerHTML = "";
        return;
      }
      entitySwitcherEl.classList.remove("clients-hidden");
      entitySwitcherEl.innerHTML = visible
        .map(function (e) {
          return (
            '<button type="button" class="clients-view-switcher__btn" data-v3entity="' +
            e.id +
            '">' +
            e.label +
            "</button>"
          );
        })
        .join("");
    },

    renderFilterChips: function (shell, state, options) {
      var wrap = document.getElementById("v3-filter-chips");
      if (!wrap) {
        return;
      }
      var chips = [];
      if (state.q) {
        chips.push({ label: "Поиск: " + state.q, key: "q" });
      }
      if (state.v3manager && options && options.managers) {
        var mgr = (options.managers || []).find(function (m) {
          return m.guid === state.v3manager;
        });
        chips.push({ label: "Менеджер: " + (mgr ? mgr.name : state.v3manager.slice(0, 8)), key: "v3manager" });
      }
      var typeTokens =
        state.v3types && state.v3types.length ? state.v3types : parseTokenList(state.v3type);
      typeTokens.forEach(function (guid) {
        var tp = options && options.types ? (options.types || []).find(function (t) { return t.guid === guid; }) : null;
        chips.push({ label: "Тип: " + (tp ? tp.name : guid), key: "v3type", token: guid });
      });
      var categoryTokens =
        state.v3categories && state.v3categories.length
          ? state.v3categories
          : parseTokenList(state.v3category);
      categoryTokens.forEach(function (guid) {
        var cat =
          options && options.categories
            ? (options.categories || []).find(function (c) {
                return c.guid === guid;
              })
            : null;
        chips.push({ label: "Категория: " + (cat ? cat.name : guid), key: "v3category", token: guid });
      });
      if (state.closed === "true") {
        chips.push({ label: "ТТ: закрыта", key: "closed" });
      } else if (state.closed === "false") {
        chips.push({ label: "ТТ: открыта", key: "closed" });
      }
      if (!chips.length) {
        wrap.classList.add("clients-hidden");
        wrap.innerHTML = "";
        return;
      }
      wrap.classList.remove("clients-hidden");
      wrap.innerHTML =
        '<span class="clients-v3-filter-chips__label">Фильтры</span>' +
        chips
          .map(function (chip) {
            return (
              '<span class="clients-v3-filter-chip">' +
              shell.escapeHtml(chip.label) +
              '<button type="button" class="clients-v3-filter-chip__clear" data-v3-clear-filter="' +
              shell.escapeHtml(chip.key) +
              '"' +
              (chip.token ? ' data-v3-clear-token="' + shell.escapeHtml(chip.token) + '"' : "") +
              ' aria-label="Снять фильтр">×</button></span>'
            );
          })
          .join("");
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
    readFiltersFromDom: readFiltersFromDom,
    mergeListStateForUserAction: mergeListStateForUserAction,
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
      if (ctx.refreshListChrome) {
        ctx.refreshListChrome(state, meta);
      } else if (ctx.pageTitleEl && ctx.rolePresentation) {
        ctx.pageTitleEl.textContent = ctx.rolePresentation.pageTitle || "Клиенты";
      }
      var params = new URLSearchParams();
      params.set("entity", state.v3entity);
      params.set("page", String(state.page));
      params.set("pageSize", String(state.pageSize || 50));
      if (state.q) {
        params.set("q", state.q);
      }
      if (state.closed === "true" || state.closed === "false") params.set("closed", state.closed);
      if (state.ropEmployee) {
        params.set("ropBranchGuid", state.ropEmployee);
      }
      var teamAssignment = isV3TeamAssignment(state);
      if (teamAssignment) {
        params.set("responsibleGuid", state.responsibleGuid);
        params.set("responsibleKind", state.responsibleKind);
      }
      if (state.v3manager && !teamAssignment) {
        params.set("managerGuid", state.v3manager);
      }
      var typeTokens =
        state.v3types && state.v3types.length ? state.v3types : parseTokenList(state.v3type);
      if (typeTokens.length > 1) params.set("typeGuids", joinTokenList(typeTokens));
      else if (typeTokens.length === 1) params.set("typeGuid", typeTokens[0]);
      var categoryTokens =
        state.v3categories && state.v3categories.length
          ? state.v3categories
          : parseTokenList(state.v3category);
      if (categoryTokens.length > 1) params.set("categoryGuids", joinTokenList(categoryTokens));
      else if (categoryTokens.length === 1) params.set("categoryGuid", categoryTokens[0]);
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
          window.ClientsV3.renderFilterChips(shell, state, optionsResult.data);
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
            var emptyTitle = state.q ? "Ничего не найдено" : "Нет записей";
            var emptyText = state.q
              ? "По запросу «" + state.q + "» нет совпадений. Измените поиск или снимите фильтры."
              : "Измените поиск или фильтры.";
            ctx.showResultsState("empty", emptyTitle, emptyText, "");
            if (ctx.formatResultCount) {
              ctx.formatResultCount(state, 0);
            } else {
              ctx.resultCountEl.textContent = "0 записей";
            }
            ctx.tableBody.innerHTML = "";
            ctx.cardsEl.innerHTML = "";
            ctx.paginationEl.innerHTML = "";
            return;
          }
          ctx.showResultsContent();
          var detailType = meta.detailEntity;
          var columns = v3ListColumns(ctx.rolePresentation, state.v3entity);
          ctx.tableHeadRow.innerHTML = columns
            .map(function (col) {
              return "<th>" + shell.escapeHtml(col.label) + "</th>";
            })
            .join("");
          ctx.tableBody.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              var cells = columns
                .map(function (col, index) {
                  if (index === 0) {
                    return (
                      "<td><a href=\"" +
                      href +
                      '">' +
                      shell.escapeHtml(item.name || item.guid) +
                      "</a></td>"
                    );
                  }
                  return "<td>" + v3CellValue(item, col, shell) + "</td>";
                })
                .join("");
              return "<tr>" + cells + "</tr>";
            })
            .join("");
          ctx.cardsEl.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              var meta = columns
                .slice(1, 4)
                .map(function (col) {
                  var value = v3CellValue(item, col, shell);
                  if (value === "—") {
                    return "";
                  }
                  return (
                    '<span class="clients-card__meta">' +
                    shell.escapeHtml(col.label) +
                    ": " +
                    value +
                    "</span>"
                  );
                })
                .join("");
              return (
                '<a class="clients-card" href="' +
                href +
                '"><span class="clients-card__title">' +
                shell.escapeHtml(item.name || item.guid) +
                "</span>" +
                meta +
                "</a>"
              );
            })
            .join("");
          var pageSize = state.pageSize || 50;
          var totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));
          if (ctx.formatResultCount) {
            ctx.formatResultCount(state, data.total || 0);
          } else {
            ctx.resultCountEl.textContent = (data.total || 0) + " записей";
          }
          ctx.renderPagination(
            {
              page: state.page,
              v3entity: state.v3entity,
              q: state.q,
              closed: state.closed,
              pageSize: pageSize,
            },
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
          next.v3types = readMultiSelectValues("v3-type-filter");
          next.v3categories = readMultiSelectValues("v3-category-filter");
          next.v3type = next.v3types[0] || "";
          next.v3category = next.v3categories[0] || "";
          next.closed = document.getElementById("v3-closed-filter")?.value || "";
          var teamView = next.v3view === "teams" || next.ropEmployee;
          if (id === "v3-manager-filter" && teamView) {
            if (next.v3manager) {
              next.responsibleGuid = next.v3manager;
              next.responsibleKind = "manager";
            } else {
              next.responsibleGuid = "";
              next.responsibleKind = "";
            }
          }
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
      var loadSource = hooks.loadSource || "";
      var syncedV3 = legacyStateToV3(legacyState, loadSource);
      writeState(syncedV3, replaceHistory);
      hooks.showAppShell();
      hooks.updateViewChrome(legacyState);
      window.ClientsV3.bindFilters(ctx, function (nextV3) {
        window.ClientsV3.loadList(ctx, nextV3, true);
      });
      var v3state = syncedV3;
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
          return Promise.resolve(hooks.renderTeamsPanel(legacyState)).then(function () {
            hooks.updateViewChrome(legacyState);
            ctx.showResultsState(
              "empty",
              legacyState.ropEmployee ? "Выберите ответственного" : "Выберите РОП",
              "Список v3 загрузится после выбора ответственного.",
              "",
            );
          });
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
          v3types: [],
          v3categories: [],
          v3view: readState().v3view,
          missingManager: false,
          ropEmployee: readState().ropEmployee,
          responsibleGuid: "",
          responsibleKind: "",
        },
        true,
      );
    },

    mergeFromLegacyState: mergeFromLegacyState,
    legacyStateToV3: legacyStateToV3,
  };

  function paramsEnsureV3Mode() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("v3mode") !== "1") {
      params.set("v3mode", "1");
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString());
    }
  }
})();
