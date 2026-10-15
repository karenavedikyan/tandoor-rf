(function () {
  "use strict";

  var v3ListLoadGeneration = 0;
  var v3FilterReloadRef = null;
  var v3FilterCtxRef = null;

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
      v3cols: params.get("v3cols") || "",
      v3dense: params.get("v3dense") === "1",
      city: params.get("v3city") || "",
      colManager: params.get("colManager") || "",
      colRegional: params.get("colRegional") || "",
      colRop: params.get("colRop") || "",
      colCity: params.get("colCity") || "",
      colStatus: params.get("colStatus") || "",
      filterOpen: params.get("filterOpen") === "1",
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
      city: document.getElementById("v3-city-filter")?.value || "",
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

  function resolveV3MultiFilter(legacy, fromUrl, urlFilters, domFilters, singleKey, multiKey) {
    if (legacy && Object.prototype.hasOwnProperty.call(legacy, multiKey)) {
      var legacyVal = legacy[multiKey];
      if (Array.isArray(legacyVal)) {
        return legacyVal.slice();
      }
      return parseTokenList(legacyVal);
    }
    if (!fromUrl && domFilters) {
      var domTokens = (domFilters[multiKey] || []).slice();
      if (domTokens.length) {
        return domTokens;
      }
    }
    if (urlFilters[multiKey] && urlFilters[multiKey].length) {
      return urlFilters[multiKey].slice();
    }
    var single = v3FilterFallback(singleKey, legacy, fromUrl, urlFilters, domFilters);
    return parseTokenList(single);
  }

  function listFilterTokens(state, multiKey, singleKey) {
    if (Object.prototype.hasOwnProperty.call(state, multiKey)) {
      return Array.isArray(state[multiKey]) ? state[multiKey].slice() : parseTokenList(state[multiKey]);
    }
    if (state[multiKey] && state[multiKey].length) {
      return state[multiKey].slice();
    }
    return parseTokenList(state[singleKey]);
  }

  function syncV3FilterAliases(state) {
    if (Object.prototype.hasOwnProperty.call(state, "v3types")) {
      state.v3type = state.v3types[0] || "";
    } else if (state.v3types && state.v3types.length) {
      state.v3type = state.v3types[0];
    }
    if (Object.prototype.hasOwnProperty.call(state, "v3categories")) {
      state.v3category = state.v3categories[0] || "";
    } else if (state.v3categories && state.v3categories.length) {
      state.v3category = state.v3categories[0];
    }
  }

  function appendTypeCategoryParams(params, state) {
    var typeTokens = listFilterTokens(state, "v3types", "v3type");
    if (typeTokens.length > 1) {
      params.set("typeGuids", joinTokenList(typeTokens));
    } else if (typeTokens.length === 1) {
      params.set("typeGuid", typeTokens[0]);
    }
    var categoryTokens = listFilterTokens(state, "v3categories", "v3category");
    if (categoryTokens.length > 1) {
      params.set("categoryGuids", joinTokenList(categoryTokens));
    } else if (categoryTokens.length === 1) {
      params.set("categoryGuid", categoryTokens[0]);
    }
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
      v3types: dom.v3types.length
        ? dom.v3types.slice()
        : url.v3types.length
          ? url.v3types.slice()
          : parseTokenList(url.v3type),
      v3categories: dom.v3categories.length
        ? dom.v3categories.slice()
        : url.v3categories.length
          ? url.v3categories.slice()
          : parseTokenList(url.v3category),
      missingManager: url.missingManager,
      ropEmployee: url.ropEmployee,
      responsibleGuid: url.responsibleGuid,
      responsibleKind: url.responsibleKind,
      pageSize: url.pageSize || 50,
      v3cols: url.v3cols || "",
      v3dense: url.v3dense,
      city: dom.city || url.city || "",
      colManager: url.colManager || "",
      colRegional: url.colRegional || "",
      colRop: url.colRop || "",
      colCity: url.colCity || "",
      colStatus: url.colStatus || "",
    };
    if (patch) {
      Object.keys(patch).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          next[key] = patch[key];
        }
      });
    }
    syncV3FilterAliases(next);
    var teamContext = next.v3view === "teams" || next.ropEmployee;
    if (teamContext && next.v3manager) {
      next.responsibleGuid = next.v3manager;
      next.responsibleKind = "manager";
    } else if (
      teamContext &&
      patch &&
      Object.prototype.hasOwnProperty.call(patch, "v3manager") &&
      !patch.v3manager
    ) {
      next.responsibleGuid = "";
      next.responsibleKind = "";
    } else if (!teamContext && patch && Object.prototype.hasOwnProperty.call(patch, "v3manager")) {
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
    // URL parsing supplies an empty responsibleGuid default even when the
    // parameter is absent. Only an actual URL selection may clear v3manager;
    // user-action patches still retain their explicit-clear semantics.
    var explicitResponsible = logic && (
      fromUrl
        ? new URLSearchParams(window.location.search).has("responsibleGuid") ||
          logic.hasResponsibleSelection(legacy)
        : logic.hasExplicitResponsibleNavigation(legacy)
    );
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
      v3types: resolveV3MultiFilter(legacy, fromUrl, urlFilters, domFilters, "v3type", "v3types"),
      v3categories: resolveV3MultiFilter(legacy, fromUrl, urlFilters, domFilters, "v3category", "v3categories"),
      v3type: (function () {
        var types = resolveV3MultiFilter(legacy, fromUrl, urlFilters, domFilters, "v3type", "v3types");
        if (legacy && Object.prototype.hasOwnProperty.call(legacy, "v3types")) {
          return types[0] || "";
        }
        return types[0] || v3type || "";
      })(),
      v3category: (function () {
        var cats = resolveV3MultiFilter(legacy, fromUrl, urlFilters, domFilters, "v3category", "v3categories");
        if (legacy && Object.prototype.hasOwnProperty.call(legacy, "v3categories")) {
          return cats[0] || "";
        }
        return cats[0] || v3category || "";
      })(),
      missingManager: Boolean(legacy.missingManager) || (fromUrl && urlFilters.missingManager),
      ropEmployee: ropEmployee,
      responsibleGuid: assignment.responsibleGuid,
      responsibleKind: assignment.responsibleKind,
      pageSize: urlFilters.pageSize || 50,
      v3cols: urlFilters.v3cols || "",
      v3dense: !!urlFilters.v3dense,
      city: fromUrl ? urlFilters.city || "" : domFilters?.city || urlFilters.city || "",
      colManager: urlFilters.colManager || "",
      colRegional: urlFilters.colRegional || "",
      colRop: urlFilters.colRop || "",
      colCity: urlFilters.colCity || "",
      colStatus: urlFilters.colStatus || "",
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
    params.delete("v3category");
    params.delete("categoryGuids");
    var urlTypeTokens = listFilterTokens(state, "v3types", "v3type");
    if (urlTypeTokens.length > 1) {
      params.set("typeGuids", joinTokenList(urlTypeTokens));
    } else if (urlTypeTokens.length === 1) {
      params.set("v3type", urlTypeTokens[0]);
    }
    var urlCategoryTokens = listFilterTokens(state, "v3categories", "v3category");
    if (urlCategoryTokens.length > 1) {
      params.set("categoryGuids", joinTokenList(urlCategoryTokens));
    } else if (urlCategoryTokens.length === 1) {
      params.set("v3category", urlCategoryTokens[0]);
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
    if (state.v3cols) params.set("v3cols", state.v3cols);
    else params.delete("v3cols");
    if (state.v3dense) params.set("v3dense", "1");
    else params.delete("v3dense");
    if (state.city) params.set("v3city", state.city);
    else params.delete("v3city");
    ["colManager", "colRegional", "colRop", "colCity", "colStatus"].forEach(function (key) {
      if (state[key]) params.set(key, state[key]);
      else params.delete(key);
    });
    if (state.filterOpen) params.set("filterOpen", "1");
    else params.delete("filterOpen");
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
    var returnTypeTokens = listFilterTokens(s, "v3types", "v3type");
    if (returnTypeTokens.length > 1) params.set("typeGuids", joinTokenList(returnTypeTokens));
    else if (returnTypeTokens.length === 1) params.set("v3type", returnTypeTokens[0]);
    var returnCategoryTokens = listFilterTokens(s, "v3categories", "v3category");
    if (returnCategoryTokens.length > 1) params.set("categoryGuids", joinTokenList(returnCategoryTokens));
    else if (returnCategoryTokens.length === 1) params.set("v3category", returnCategoryTokens[0]);
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
    if (s.v3cols) params.set("v3cols", s.v3cols);
    if (s.v3dense) params.set("v3dense", "1");
    if (s.city) params.set("v3city", s.city);
    ["colManager", "colRegional", "colRop", "colCity", "colStatus"].forEach(function (key) {
      if (s[key]) params.set(key, s[key]);
    });
    if (s.filterOpen) params.set("filterOpen", "1");
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
    var types = listFilterTokens(state, "v3types", "v3type");
    var categories = listFilterTokens(state, "v3categories", "v3category");
    fillMultiSelect(shell, document.getElementById("v3-type-filter"), options.types, types);
    fillMultiSelect(shell, document.getElementById("v3-category-filter"), options.categories, categories);
    var closedEl = document.getElementById("v3-closed-filter");
    if (closedEl) closedEl.value = state.closed || "";
    var closedWrap = document.getElementById("v3-closed-filter-wrap");
    var isRetail = state.v3entity === "retail" || state.v3entity === "orphan_retail";
    closedWrap?.classList.toggle("clients-hidden", !isRetail);
  }

  function appendV3ListQueryParams(params, state) {
    if (state.city) params.set("city", state.city);
    if (state.colManager) params.set("colManager", state.colManager);
    if (state.colRegional) params.set("colRegional", state.colRegional);
    if (state.colRop) params.set("colRop", state.colRop);
    if (state.colCity) params.set("colCity", state.colCity);
    if (state.colStatus) params.set("colStatus", state.colStatus);
  }

  function resolveVisibleListColumns(state, userId) {
    var listUi = window.ClientsV3List;
    if (!listUi) {
      return [{ id: "name", label: "Название" }];
    }
    var ids = listUi.resolveVisibleColumns(state, userId);
    var catalog = listUi.catalogForEntity(state.v3entity);
    return ids
      .map(function (id) {
        for (var i = 0; i < catalog.length; i += 1) {
          if (catalog[i].id === id) {
            return catalog[i];
          }
        }
        return null;
      })
      .filter(Boolean);
  }

  function toggleV3ListChrome(show) {
    var bar = document.getElementById("v3-list-filterbar");
    var densityBtn = document.getElementById("v3-density-btn");
    var v3ResetBtn = document.getElementById("v3-list-reset-filters");
    bar?.classList.toggle("clients-hidden", !show);
    densityBtn?.classList.toggle("clients-hidden", !show);
    v3ResetBtn?.classList.toggle("clients-hidden", !show);
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
      var typeTokens = listFilterTokens(state, "v3types", "v3type");
      typeTokens.forEach(function (guid) {
        var tp = options && options.types ? (options.types || []).find(function (t) { return t.guid === guid; }) : null;
        chips.push({ label: "Тип: " + (tp ? tp.name : guid), key: "v3type", token: guid });
      });
      var categoryTokens = listFilterTokens(state, "v3categories", "v3category");
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
      if (state.city) {
        chips.push({ label: "Город: " + state.city, key: "city" });
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
      v3ListLoadGeneration += 1;
      var loadGeneration = v3ListLoadGeneration;
      function isStaleListLoad() {
        if (ctx.isNavigationCurrent && !ctx.isNavigationCurrent()) {
          return true;
        }
        return loadGeneration !== v3ListLoadGeneration;
      }
      if (ctx.isNavigationCurrent && !ctx.isNavigationCurrent()) {
        return Promise.resolve();
      }
      state = state || readState();
      var urlState = readState();
      if (!Object.prototype.hasOwnProperty.call(state, "v3types")) {
        state.v3types = listFilterTokens(Object.assign({}, urlState, state), "v3types", "v3type");
      }
      if (!Object.prototype.hasOwnProperty.call(state, "v3categories")) {
        state.v3categories = listFilterTokens(
          Object.assign({}, urlState, state),
          "v3categories",
          "v3category",
        );
      }
      syncV3FilterAliases(state);
      writeState(state, replaceHistory);
      toggleV3ListChrome(true);
      var legacyState = {
        view: state.v3view === "teams" ? "teams" : state.v3view === "unassigned" ? "review" : "all",
        ropEmployee: state.ropEmployee,
        responsibleGuid: state.responsibleGuid,
      };
      var lktandoorActive =
        window.ClientsLktandoorList &&
        window.ClientsLktandoorList.shouldActivate(legacyState, true);
      if (window.ClientsLktandoorList) {
        window.ClientsLktandoorList.syncLayout(lktandoorActive, state);
        document.getElementById("v3-lktandoor-field-filters")?.classList.toggle("clients-hidden", !lktandoorActive);
        if (lktandoorActive && ctx.lktandoorContext) {
          window.ClientsLktandoorList.refreshChrome(ctx.shell, state, ctx.lktandoorContext);
        }
      }
      if (window.ClientsV3List) {
        window.ClientsV3List.applyDensity(!!state.v3dense);
      }
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
      var teamAssignment =
        isV3TeamAssignment(state) || Boolean(state.responsibleGuid && state.ropEmployee);
      if (teamAssignment && state.responsibleGuid && state.responsibleKind) {
        params.set("responsibleGuid", state.responsibleGuid);
        params.set("responsibleKind", state.responsibleKind);
      }
      if (state.v3manager && !teamAssignment) {
        params.set("managerGuid", state.v3manager);
      }
      appendTypeCategoryParams(params, state);
      appendV3ListQueryParams(params, state);
      if (state.missingManager) params.set("missingManager", "true");
      var optionsPromise = api.apiRequest(
        "/api/clients/v3/options?entity=" + encodeURIComponent(state.v3entity),
      ).then(function (optionsResult) {
        if (isStaleListLoad()) {
          return;
        }
        if (optionsResult.response.ok && optionsResult.data) {
          var liveState = readState();
          syncFilterDom(shell, liveState, optionsResult.data);
          window.ClientsV3.renderFilterChips(shell, liveState, optionsResult.data);
          if (window.ClientsV3List) {
            window.ClientsV3List.syncFilterbar(shell, liveState, optionsResult.data);
          }
        }
      });
      var listPromise = api
        .apiRequest("/api/clients/v3/list?" + params.toString(), { signal: ctx.nextListFetchSignal?.() })
        .then(function (result) {
          if (isStaleListLoad()) {
            return;
          }
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
          var listUi = window.ClientsV3List;
          var visibleCols = resolveVisibleListColumns(state, ctx.currentUserId);
          if (listUi && ctx.tableHeadRow) {
            listUi.renderTableHead(shell, ctx.tableHeadRow, visibleCols, state, function (filterKey, value) {
              var patch = { page: 1 };
              patch[filterKey] = value;
              if (filterKey === "q") {
                var searchEl = document.getElementById("search-input");
                if (searchEl) {
                  searchEl.value = value;
                }
              }
              window.ClientsV3.loadList(ctx, mergeListStateForUserAction(patch), false);
            });
          }
          ctx.tableBody.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              var cells = visibleCols
                .map(function (col, index) {
                  if (index === 0) {
                    return (
                      '<td data-label="' +
                      shell.escapeHtml(col.label) +
                      '"><a class="clients-link" href="' +
                      href +
                      '">' +
                      shell.escapeHtml(item.name || item.guid) +
                      "</a></td>"
                    );
                  }
                  return (
                    '<td data-label="' +
                    shell.escapeHtml(col.label) +
                    '">' +
                    (listUi ? listUi.cellDisplay(item, col.id, shell) : "—") +
                    "</td>"
                  );
                })
                .join("");
              return "<tr>" + cells + "</tr>";
            })
            .join("");
          var useLktandoorMobile =
            window.ClientsLktandoorList && document.getElementById("clients-app")?.classList.contains("clients-lktandoor-list");
          ctx.cardsEl.className = useLktandoorMobile ? "clients-cards x13-mobile-list" : "clients-cards";
          ctx.tableBody.closest(".clients-table-wrap")?.classList.toggle("x13-desktop-list", !!useLktandoorMobile);
          ctx.cardsEl.innerHTML = items
            .map(function (item) {
              var href = detailHref(item.guid, detailType, state);
              if (useLktandoorMobile && window.ClientsLktandoorList) {
                return window.ClientsLktandoorList.renderMobileCard(shell, item, visibleCols, href, listUi, state);
              }
              var metaLine = listUi ? listUi.mobileMetaLine(item, visibleCols, shell) : "";
              return (
                '<article class="clients-card">' +
                '<h2 class="clients-card__title"><a class="clients-link" href="' +
                href +
                '">' +
                shell.escapeHtml(item.name || item.guid) +
                "</a></h2>" +
                (metaLine
                  ? '<p class="clients-card__line"><span class="clients-card__meta">' +
                    shell.escapeHtml(metaLine) +
                    "</span></p>"
                  : "") +
                "</article>"
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
      return Promise.all([optionsPromise, listPromise]);
    },

    bindFilters: function (ctx, reload) {
      v3FilterReloadRef = reload;
      v3FilterCtxRef = ctx;
      ["v3-manager-filter", "v3-type-filter", "v3-category-filter", "v3-closed-filter"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || el.dataset.v3Bound) return;
        el.dataset.v3Bound = "1";
        el.addEventListener("change", function () {
          var liveCtx = v3FilterCtxRef || ctx;
          var liveReload = v3FilterReloadRef || reload;
          var next = readState();
          next.v3manager = document.getElementById("v3-manager-filter")?.value || "";
          next.v3types = readMultiSelectValues("v3-type-filter");
          next.v3categories = readMultiSelectValues("v3-category-filter");
          syncV3FilterAliases(next);
          next.closed = document.getElementById("v3-closed-filter")?.value || "";
          var teamView = next.v3view === "teams" || next.ropEmployee;
          if (id === "v3-manager-filter") {
            if (teamView) {
              if (next.v3manager) {
                next.responsibleGuid = next.v3manager;
                next.responsibleKind = "manager";
              } else {
                next.responsibleGuid = "";
                next.responsibleKind = "";
              }
            } else {
              next.responsibleGuid = "";
              next.responsibleKind = "";
            }
          }
          next.page = 1;
          next.q = liveCtx.getSearchQuery ? liveCtx.getSearchQuery() : next.q;
          liveReload(next);
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
      function navigationIsStale() {
        if (hooks.isNavigationCurrent) {
          return !hooks.isNavigationCurrent();
        }
        if (hooks.requestId != null && hooks.activeRequestId != null) {
          return hooks.requestId !== hooks.activeRequestId;
        }
        return false;
      }
      var loadSource = hooks.loadSource || "";
      var syncedV3 = legacyStateToV3(legacyState, loadSource);
      var urlNow = readState();
      if (!Object.prototype.hasOwnProperty.call(legacyState || {}, "v3types")) {
        if (urlNow.v3types && urlNow.v3types.length) {
          syncedV3.v3types = urlNow.v3types.slice();
        }
      }
      if (!Object.prototype.hasOwnProperty.call(legacyState || {}, "v3categories")) {
        if (urlNow.v3categories && urlNow.v3categories.length) {
          syncedV3.v3categories = urlNow.v3categories.slice();
        }
      }
      syncV3FilterAliases(syncedV3);
      if (navigationIsStale()) {
        return Promise.resolve();
      }
      writeState(syncedV3, replaceHistory);
      hooks.showAppShell();
      hooks.updateViewChrome(legacyState);
      window.ClientsV3.bindFilters(ctx, function (nextV3) {
        if (hooks.reloadFromV3Filters) {
          hooks.reloadFromV3Filters(nextV3);
          return;
        }
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
          if (navigationIsStale()) return;
          if (!teamCtx.ok) {
            ctx.showResultsState("error", "Не удалось загрузить команду", "Повторите попытку.", "");
            return;
          }
          return Promise.resolve(hooks.renderTeamsPanel(legacyState)).then(function () {
            if (navigationIsStale()) return;
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

      var teamsResponsibleList =
        legacyState.view === "teams" &&
        !hooks.logic.isBranchPortfolioList(legacyState) &&
        hooks.logic.hasResponsibleSelection(legacyState) &&
        Boolean(legacyState.ropEmployee);
      if (teamsResponsibleList) {
        ctx.showResultsState("loading", "Загрузка команд…", "", "");
        return hooks.loadTeamsContext(legacyState).then(function (teamCtx) {
          if (navigationIsStale()) {
            return;
          }
          if (!teamCtx.ok) {
            ctx.showResultsState("error", "Не удалось загрузить команду", "Повторите попытку.", "");
            return;
          }
          return Promise.resolve(hooks.renderTeamsPanel(legacyState)).then(function () {
            if (navigationIsStale()) {
              return;
            }
            hooks.updateViewChrome(legacyState);
            return window.ClientsV3.loadList(ctx, v3state, replaceHistory);
          });
        });
      }

      var unassignedPick =
        legacyState.view === "review" &&
        !legacyState.manager &&
        !legacyState.unassignedCategory;
      if (unassignedPick) {
        return ctx.api.apiRequest("/api/clients/v3/unassigned-summary").then(function (result) {
          if (navigationIsStale()) {
            return;
          }
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
      var url = readState();
      var teamScope = url.v3view === "teams" || url.ropEmployee;
      var keepManager =
        teamScope && url.responsibleGuid && url.responsibleKind === "manager" ? url.responsibleGuid : "";
      window.ClientsV3.loadList(
        ctx,
        {
          v3entity: url.v3entity,
          page: 1,
          q: "",
          closed: "",
          v3manager: keepManager,
          v3type: "",
          v3category: "",
          v3types: [],
          v3categories: [],
          v3view: url.v3view,
          missingManager: false,
          ropEmployee: url.ropEmployee,
          responsibleGuid: teamScope ? url.responsibleGuid : "",
          responsibleKind: teamScope ? url.responsibleKind : "",
          city: "",
          colManager: "",
          colRegional: "",
          colRop: "",
          colCity: "",
          colStatus: "",
          v3cols: url.v3cols,
          v3dense: url.v3dense,
          pageSize: url.pageSize,
          filterOpen: false,
        },
        true,
      );
    },

    bindListChrome: function (ctx) {
      if (window.__clientsV3ListChromeBound) {
        return;
      }
      window.__clientsV3ListChromeBound = true;
      function currentContext() {
        return typeof ctx === "function" ? ctx() : ctx;
      }
      var cityEl = document.getElementById("v3-city-filter");
      cityEl?.addEventListener("change", function () {
        window.ClientsV3.loadList(
          currentContext(),
          mergeListStateForUserAction({ city: cityEl.value || "", page: 1 }),
          false,
        );
      });
      var categoryQuick = document.getElementById("v3-lktandoor-category-filter");
      categoryQuick?.addEventListener("change", function () {
        var guid = categoryQuick.value || "";
        window.ClientsV3.loadList(
          currentContext(),
          mergeListStateForUserAction({
            v3categories: guid ? [guid] : [],
            v3category: guid,
            page: 1,
          }),
          false,
        );
      });
      if (window.ClientsLktandoorList) {
        window.ClientsLktandoorList.bindFilterPanel();
      }
      document.getElementById("v3-density-btn")?.addEventListener("click", function () {
        var url = readState();
        window.ClientsV3.loadList(
          currentContext(),
          mergeListStateForUserAction({ v3dense: !url.v3dense, page: url.page }),
          true,
        );
      });
    },

    renderV3ColumnPicker: function (ctx, pickerEl, state) {
      if (!window.ClientsV3List || !pickerEl) {
        return;
      }
      var visibleIds = window.ClientsV3List.resolveVisibleColumns(state, ctx.currentUserId);
      window.ClientsV3List.renderColumnPicker(
        ctx.shell,
        pickerEl,
        state.v3entity,
        visibleIds,
        ctx.currentUserId,
        function (nextIds) {
          var nextCols = window.ClientsV3List.columnsParamFromIds(nextIds);
          window.ClientsV3.loadList(
            ctx,
            mergeListStateForUserAction({ v3cols: nextCols, page: readState().page }),
            true,
          );
        },
      );
    },

    mergeFromLegacyState: mergeFromLegacyState,
    legacyStateToV3: legacyStateToV3,
    buildListReturnQuery: buildListReturnQuery,
    listFilterTokens: listFilterTokens,
    appendTypeCategoryParams: appendTypeCategoryParams,
    resetListLoadGenerationForTests: function () {
      v3ListLoadGeneration = 0;
    },
    getListLoadGenerationForTests: function () {
      return v3ListLoadGeneration;
    },
  };

  function paramsEnsureV3Mode() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("v3mode") !== "1") {
      params.set("v3mode", "1");
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString());
    }
  }
})();
