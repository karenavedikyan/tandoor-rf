(function () {
  "use strict";

  var scopeCountsCacheKey = "";

  function territoryParamsFromState(state) {
    var teamAssignment =
      Boolean(state.responsibleGuid && state.responsibleKind && (state.v3view === "teams" || state.ropEmployee)) ||
      Boolean(state.responsibleGuid && state.ropEmployee);
    var params = new URLSearchParams();
    if (state.ropEmployee) {
      params.set("ropBranchGuid", state.ropEmployee);
    }
    if (teamAssignment && state.responsibleGuid && state.responsibleKind) {
      params.set("responsibleGuid", state.responsibleGuid);
      params.set("responsibleKind", state.responsibleKind);
    } else if (state.v3manager && !teamAssignment) {
      params.set("managerGuid", state.v3manager);
    }
    return params;
  }

  function scopeTitle(state, ctx) {
    var role = ctx.rolePresentation && ctx.rolePresentation.businessRole;
    if (state.responsibleGuid && ctx.teamContext && ctx.teamContext.managerName) {
      return "Территория: " + ctx.teamContext.managerName;
    }
    if (state.ropEmployee && ctx.teamContext && ctx.teamContext.ropName && !state.responsibleGuid) {
      return "Территория команды: " + ctx.teamContext.ropName;
    }
    if (role === "admin") {
      return "Вся база";
    }
    return "Моя клиентская база";
  }

  function contextParts(state, ctx) {
    var role = ctx.rolePresentation && ctx.rolePresentation.businessRole;
    var parts = [];
    if (role === "rop") {
      parts.push("Моя команда");
    } else if (role === "director" || role === "admin") {
      parts.push("Мои РОПы");
    } else {
      parts.push("Мои клиенты");
    }
    if (state.ropEmployee && role !== "rop" && ctx.teamContext && ctx.teamContext.ropName) {
      parts.push(ctx.teamContext.ropName);
    }
    if (state.responsibleGuid && ctx.teamContext && ctx.teamContext.managerName) {
      parts.push(ctx.teamContext.managerName);
    }
    if (state.v3view === "teams" && (state.responsibleGuid || state.ropEmployee)) {
      parts.push("Клиентская база");
    } else if (state.v3view === "all" && (state.responsibleGuid || state.ropEmployee)) {
      parts.push("Клиентская база");
    }
    return parts;
  }

  function isTeamsDirectoryNav(state, ctx) {
    var legacyProbe = {
      view: "teams",
      ropEmployee: state.ropEmployee || "",
      manager: state.v3manager || "",
      responsibleGuid: state.responsibleGuid || "",
    };
    return (
      (state.v3view === "teams" || state.view === "teams") &&
      !state.ropEmployee &&
      !state.responsibleGuid &&
      !state.v3manager &&
      !(ctx.logic && ctx.logic.hasResponsibleSelection(legacyProbe))
    );
  }

  function renderContextNav(shell, state, ctx) {
    var el = document.getElementById("v3-lktandoor-context-nav");
    if (!el) {
      return;
    }
    if (isTeamsDirectoryNav(state, ctx)) {
      el.innerHTML = "";
      el.classList.add("clients-hidden");
      return;
    }
    el.classList.remove("clients-hidden");
    var parts = contextParts(state, ctx);
    var legacyProbe = {
      view: "teams",
      ropEmployee: state.ropEmployee || "",
      manager: state.v3manager || "",
      responsibleGuid: state.responsibleGuid || "",
    };
    var showBack =
      Boolean(state.responsibleGuid || state.ropEmployee) ||
      (ctx.logic && ctx.logic.hasResponsibleSelection(legacyProbe));
    var trail = parts
      .map(function (label, index) {
        var current = index === parts.length - 1 ? ' aria-current="page"' : "";
        return "<span" + current + ">" + shell.escapeHtml(label) + "</span>";
      })
      .join('<i aria-hidden="true">/</i>');
    var viewing = state.responsibleGuid ? "Просмотр территории сотрудника" : "";
    el.innerHTML =
      (showBack
        ? '<button type="button" class="x13-back" id="v3-lktandoor-back" data-testid="v3-lktandoor-back">← Назад</button>'
        : "") +
      '<nav aria-label="Путь к выбранной территории">' +
      trail +
      "</nav>" +
      (viewing ? '<span class="x13-viewing">' + shell.escapeHtml(String(viewing)) + "</span>" : "");
    document.getElementById("v3-lktandoor-back")?.addEventListener("click", function () {
      if (ctx.onBack) {
        ctx.onBack(state);
      }
    });
  }

  function renderSectionHeading(state, ctx) {
    var el = document.getElementById("v3-lktandoor-section-heading");
    if (!el) {
      return;
    }
    var showFieldMap =
      ctx.rolePresentation &&
      (ctx.rolePresentation.businessRole === "admin" ||
        (ctx.rolePresentation.capabilities && ctx.rolePresentation.capabilities.fieldCatalog));
    el.innerHTML =
      '<div><span class="x7-eyebrow">КЛИЕНТЫ И ТЕРРИТОРИИ</span><h2>Клиентская база</h2><p>Поиск, фильтры и карточки в пределах выбранной территории</p></div>' +
      (showFieldMap
        ? '<a class="workspace-button workspace-button--ghost" href="/clients/field-map">Карта полей</a>'
        : "");
  }

  function renderScopeBar(shell, state, counts) {
    var el = document.getElementById("v3-lktandoor-scope-bar");
    if (!el) {
      return;
    }
    var legal = counts && typeof counts.legal === "number" ? counts.legal : "—";
    var retail = counts && typeof counts.retail === "number" ? counts.retail : "—";
    var entity = state.v3entity || "legal";
    var isLegal = entity === "legal" || entity === "legal_grouped" || entity === "holdings";
    el.innerHTML =
      "<div><b id=\"v3-lktandoor-scope-title\"></b><span>Только записи этой территории. Поиск и фильтры не расширяют область.</span></div>" +
      '<div class="x6-scopebar__counts">' +
      '<button type="button" data-v3-scope-entity="legal"' +
      (isLegal ? ' class="selected"' : "") +
      ">Клиенты · " +
      shell.escapeHtml(String(legal)) +
      "</button>" +
      '<button type="button" data-v3-scope-entity="retail"' +
      (!isLegal ? ' class="selected"' : "") +
      ">ТТ · " +
      shell.escapeHtml(String(retail)) +
      "</button></div>";
    var titleEl = document.getElementById("v3-lktandoor-scope-title");
    if (titleEl && window.__lktandoorScopeTitle) {
      titleEl.textContent = window.__lktandoorScopeTitle;
    }
    el.querySelectorAll("[data-v3-scope-entity]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var nextEntity = btn.getAttribute("data-v3-scope-entity");
        if (!nextEntity || !window.ClientsV3) {
          return;
        }
        var patch = { v3entity: nextEntity === "retail" ? "retail" : "legal_grouped", page: 1 };
        window.ClientsV3.loadList(window.__lktandoorUiCtx, window.ClientsV3.mergeListStateForUserAction(patch), false);
      });
    });
  }

  function activeRuleCount(state) {
    var n = 0;
    if (state.v3manager) n += 1;
    if (state.city) n += 1;
    if (state.closed) n += 1;
    var types = window.ClientsV3 && window.ClientsV3.listFilterTokens ? window.ClientsV3.listFilterTokens(state, "v3types", "v3type") : [];
    var cats = window.ClientsV3 && window.ClientsV3.listFilterTokens ? window.ClientsV3.listFilterTokens(state, "v3categories", "v3category") : [];
    n += types.length + cats.length;
    ["colManager", "colRegional", "colRop", "colCity", "colStatus"].forEach(function (key) {
      if (state[key]) n += 1;
    });
    return n;
  }

  function renderFilterSummary(shell, state, options, onRemove) {
    if (window.ClientsV3FieldRules && options) {
      window.ClientsV3FieldRules.renderChips(shell, state, options, onRemove || function () {});
      return;
    }
    var summary = document.getElementById("v3-lktandoor-filter-summary");
    if (summary && state.v3Rules) {
      summary.textContent = "Фильтры по всем полям · " + (state.v3Rules.length || 0);
    }
  }

  function syncLayout(active, state, options) {
    options = options || {};
    document.body.classList.toggle("clients-lktandoor-mode", active);
    var app = document.getElementById("clients-app");
    var chrome = document.getElementById("v3-lktandoor-chrome");
    var panel = document.getElementById("v3-lktandoor-list-panel");
    var managerChrome = document.getElementById("clients-manager-chrome");
    var viewSwitcher = document.getElementById("view-switcher");
    var breadcrumbs = document.getElementById("clients-breadcrumbs");
    var filterChips = document.getElementById("v3-filter-chips");
    if (app) {
      app.classList.toggle("clients-lktandoor-list", active);
      app.classList.toggle("x13", active);
    }
    if (options.manageChrome !== false) {
      chrome?.classList.toggle("clients-hidden", !active);
    }
    panel?.classList.toggle("clients-hidden", !active);
    if (active) {
      managerChrome?.classList.add("clients-hidden");
      viewSwitcher?.classList.add("clients-hidden");
      breadcrumbs?.classList.add("clients-hidden");
      filterChips?.classList.add("clients-hidden");
    } else {
      managerChrome?.classList.remove("clients-hidden");
      viewSwitcher?.classList.remove("clients-hidden");
    }
    var details = document.getElementById("v3-lktandoor-field-filters");
    if (details && state && state.filterOpen) {
      details.open = true;
    }
  }

  function renderMobileCard(shell, item, visibleCols, href, listUi, state) {
    var primaryCol = visibleCols[0] || { id: "name" };
    var name = item[primaryCol.id] || item.client_name || item.name || item.guid;
    var addressCol = visibleCols.find(function (c) {
      return c.id === "store_address" || c.id === "address_line";
    });
    var address = addressCol
      ? listUi.cellDisplay(item, addressCol.id, shell).replace(/<[^>]+>/g, "")
      : item.store_address || item.address_line || item.city || "Адрес не передан";
    var category = item.category_name || item.type_name || "";
    var badge = category || "—";
    var extraCols = visibleCols.filter(function (col) {
      return col.id !== primaryCol.id && col.id !== "store_address" && col.id !== "address_line";
    });
    var fieldsHtml = extraCols
      .map(function (col) {
        var val = listUi.cellDisplay(item, col.id, shell).replace(/<[^>]+>/g, "");
        return "<span><small>" + shell.escapeHtml(col.label) + "</small><b>" + val + "</b></span>";
      })
      .join("");
    return (
      '<a class="x13-client-card" href="' +
      href +
      '" data-testid="v3-lktandoor-mobile-card">' +
      '<span class="x13-client-card-title"><strong>' +
      shell.escapeHtml(name) +
      '</strong><span aria-hidden="true">→</span></span>' +
      '<span class="x13-client-card-address">' +
      shell.escapeHtml(String(address)) +
      "</span>" +
      (badge
        ? '<span class="x7-badge">' + shell.escapeHtml(String(badge)) + "</span>"
        : "") +
      (fieldsHtml ? '<span class="x13-mobile-fields">' + fieldsHtml + "</span>" : "") +
      '<span class="x13-open-card">Открыть карточку</span></a>'
    );
  }

  function loadScopeCounts(api, state) {
    var params = territoryParamsFromState(state);
    var key = params.toString();
    if (key === scopeCountsCacheKey && window.__lktandoorScopeCounts) {
      return Promise.resolve(window.__lktandoorScopeCounts);
    }
    return api.apiRequest("/api/clients/v3/scope-summary?" + params.toString()).then(function (result) {
      if (result.response.ok && result.data) {
        scopeCountsCacheKey = key;
        window.__lktandoorScopeCounts = result.data;
        return result.data;
      }
      return { legal: null, retail: null };
    });
  }

  function shouldActivate(state, exchangeV3Active) {
    if (!exchangeV3Active || !window.ClientsV3) {
      return false;
    }
    if ((state.view || "all") === "completeness") {
      return false;
    }
    var teamsView =
      (state.view || "all") === "teams" || state.v3view === "teams";
    if (teamsView && window.ClientsLogic && window.ClientsLogic.isTeamsRosterView) {
      var rosterProbe = Object.assign({ view: "teams" }, state);
      if (window.ClientsLogic.isTeamsRosterView(rosterProbe)) {
        return false;
      }
    }
    if (teamsView && !state.ropEmployee && !state.responsibleGuid && !state.v3manager) {
      return false;
    }
    if (window.ClientsLktandoorTeams && window.ClientsLktandoorTeams.isTeamsDirectory(state)) {
      return false;
    }
    if ((state.view || "all") === "review" && !state.unassignedCategory && !state.manager) {
      return false;
    }
    return true;
  }

  window.ClientsLktandoorList = {
    shouldActivate: shouldActivate,
    syncLayout: syncLayout,
    renderContextNav: renderContextNav,
    renderSectionHeading: renderSectionHeading,
    renderScopeBar: renderScopeBar,
    renderFilterSummary: renderFilterSummary,
    renderMobileCard: renderMobileCard,
    loadScopeCounts: loadScopeCounts,
    scopeTitle: scopeTitle,
    refreshChrome: function (shell, state, ctx) {
      window.__lktandoorUiCtx = ctx.uiCtx;
      window.__lktandoorScopeTitle = scopeTitle(state, ctx);
      var titleEl = document.getElementById("v3-lktandoor-scope-title");
      if (titleEl) {
        titleEl.textContent = window.__lktandoorScopeTitle;
      }
      renderContextNav(shell, state, ctx);
      renderSectionHeading(state, ctx);
      var opts = window.__lktandoorFilterOptions || ctx.filterOptions || { entity: state.v3entity };
      renderFilterSummary(shell, state, opts, function (index) {
        var next = window.ClientsV3.readState();
        var rules = window.ClientsV3FieldRules.parseRulesFromState(next);
        rules.splice(index, 1);
        next.v3Rules = rules;
        window.ClientsV3FieldRules.syncLegacyFromRules(next);
        window.ClientsV3.loadList(ctx.uiCtx || window.__lktandoorUiCtx, next, false);
      });
      loadScopeCounts(ctx.api, state).then(function (counts) {
        var current = window.ClientsV3.readState();
        if (territoryParamsFromState(current).toString() !== territoryParamsFromState(state).toString()) return;
        renderScopeBar(shell, state, counts);
      });
    },
    bindFilterPanel: function () {
      if (window.__lktandoorFilterBound) {
        return;
      }
      window.__lktandoorFilterBound = true;
      var details = document.getElementById("v3-lktandoor-field-filters");
      details?.addEventListener("toggle", function () {
        if (!window.ClientsV3) {
          return;
        }
        var state = window.ClientsV3.readState();
        state.filterOpen = details.open;
        window.ClientsV3.writeState(state, true);
      });
    },
  };
})();
