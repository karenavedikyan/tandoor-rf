(function () {
  "use strict";

  var filterTimer = null;
  var scrollStoragePrefix = "clients-v3-focus-scroll:";

  function clearFocusSearchDebounce() {
    clearTimeout(filterTimer);
    filterTimer = null;
  }

  function bumpFocusSearchResetEpoch() {
    window.__v3FocusSearchResetEpoch = (window.__v3FocusSearchResetEpoch || 0) + 1;
    return window.__v3FocusSearchResetEpoch;
  }

  function rememberFocusSearchUserPick(value) {
    window.__v3FocusSearchUserPick = value;
  }

  function clearFocusSearchUserPick() {
    delete window.__v3FocusSearchUserPick;
  }

  function scheduleFocusSearchCommit(reload, value, caret) {
    var trimmed = String(value || "").trim();
    var resetEpoch = window.__v3FocusSearchResetEpoch || 0;
    window.__v3FocusSearchDebounceSnap = {
      value: value || "",
      caret: caret,
      resetEpoch: resetEpoch,
    };
    clearFocusSearchDebounce();
    filterTimer = setTimeout(function () {
      if (resetEpoch !== (window.__v3FocusSearchResetEpoch || 0)) {
        window.__v3FocusSearchDebounceSnap = null;
        return;
      }
      window.__v3FocusSearchDebounceSnap = null;
      var main = document.getElementById("search-input");
      if (main) {
        main.value = value || "";
      }
      reload(
        window.ClientsV3.mergeListStateForUserAction({ q: trimmed, page: 1 }),
        { id: "v3-focus-search", position: caret },
      );
    }, 180);
  }

  function flushScheduledFocusSearchCommit(reload) {
    var snap = window.__v3FocusSearchDebounceSnap;
    if (!snap || !window.ClientsV3) {
      return;
    }
    if (snap.resetEpoch !== (window.__v3FocusSearchResetEpoch || 0)) {
      window.__v3FocusSearchDebounceSnap = null;
      clearFocusSearchDebounce();
      return;
    }
    var live = window.ClientsV3.readState();
    var trimmed = String(snap.value || "").trim();
    if (String(live.q || "").trim() === trimmed) {
      window.__v3FocusSearchDebounceSnap = null;
      clearFocusSearchDebounce();
      return;
    }
    clearFocusSearchDebounce();
    window.__v3FocusSearchDebounceSnap = null;
    var main = document.getElementById("search-input");
    if (main) {
      main.value = snap.value || "";
    }
    reload(
      window.ClientsV3.mergeListStateForUserAction({ q: trimmed, page: 1 }),
      { id: "v3-focus-search", position: snap.caret },
    );
  }

  function prepareFocusExplicitReset() {
    clearFocusSearchDebounce();
    bumpFocusSearchResetEpoch();
    clearFocusSearchUserPick();
    window.__v3FocusSearchDebounceSnap = null;
    delete window.__v3FocusEnumLastIntent;
    window.__v3FocusEnumUserPick = {};
    var focusSearch = document.getElementById("v3-focus-search");
    if (focusSearch) {
      focusSearch.value = "";
    }
    var mainSearch = document.getElementById("search-input");
    if (mainSearch) {
      mainSearch.value = "";
    }
  }

  var COL_FILTER = {
    name: { kind: "rule", field: "groupDisplayName", input: "text", op: "contains" },
    client_name: { kind: "rule", field: "clientName", input: "text", op: "contains" },
    address_line: { kind: "rule", field: "legalAddress", input: "text", op: "contains" },
    category_name: { kind: "rule", field: "typeGuid", input: "enum", optionsKey: "types" },
    legal_name: { kind: "rule", field: "legalName", input: "text", op: "contains" },
    city: { kind: "rule", field: "city", input: "text", op: "contains" },
    manager_name: { kind: "col", key: "colManager", input: "text" },
    regional_name: { kind: "col", key: "colRegional", input: "text" },
    rop_name: { kind: "col", key: "colRop", input: "text" },
    status_label: { kind: "col", key: "colStatus", input: "text" },
    store_address: { kind: "rule", field: "storeAddress", input: "text", op: "contains" },
    lpr_name: { kind: "rule", field: "lprName", input: "text", op: "contains" },
    club_status: { kind: "rule", field: "clubStatus", input: "text", op: "contains" },
    club_bonus: { kind: "rule", field: "clubBonus", input: "text", op: "contains" },
    closed: { kind: "rule", field: "closed", input: "bool" },
    type_name: { kind: "rule", field: "categoryGuid", input: "enum", optionsKey: "categories" },
    discount_amount: { kind: "rule", field: "discountAmount", input: "number" },
    defer_days: { kind: "rule", field: "deferDays", input: "number" },
    credit_limit: { kind: "rule", field: "creditLimit", input: "number" },
    markup_percentage: { kind: "rule", field: "markupPercentage", input: "text", op: "contains" },
    contract_number: { kind: "rule", field: "contractNumber", input: "text", op: "contains" },
    payment_type: { kind: "rule", field: "paymentType", input: "text", op: "contains" },
    inn: { kind: "rule", field: "inn", input: "text", op: "contains" },
  };

  function filterControlId(colId, kind, op) {
    var base = "v3-focus-filter-" + colId;
    if (kind === "number" && op) {
      return base + "-" + op;
    }
    if (kind) {
      return base + "-" + kind;
    }
    return base;
  }

  function restoreFilterEditor(editor) {
    if (!editor) {
      return;
    }
    var restore =
      (editor.id && document.getElementById(editor.id)) ||
      (editor.colId
        ? editor.op
          ? document.querySelector(
              '[data-focus-col="' +
                editor.colId +
                '"][data-focus-op="' +
                editor.op +
                '"]',
            )
          : document.querySelector(
              '[data-focus-col="' +
                editor.colId +
                '"][data-focus-kind="' +
                (editor.kind || "text") +
                '"]',
            )
        : null);
    if (!restore) {
      return;
    }
    restore.focus({ preventScroll: true });
    if (typeof editor.position === "number" && restore.setSelectionRange) {
      restore.setSelectionRange(editor.position, editor.position);
    }
  }

  function isActive(state) {
    return Boolean(state && state.v3focus);
  }

  function scrollKey(state) {
    return (
      scrollStoragePrefix +
      (state.v3entity || "") +
      ":" +
      (state.responsibleGuid || state.v3manager || "") +
      ":" +
      (state.ropEmployee || "")
    );
  }

  function readScroll(state) {
    try {
      var raw = sessionStorage.getItem(scrollKey(state));
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (_err) {
      /* ignore */
    }
    return { top: 0, left: 0 };
  }

  function writeScroll(state, pane) {
    if (!pane) {
      return;
    }
    try {
      sessionStorage.setItem(
        scrollKey(state),
        JSON.stringify({ top: pane.scrollTop, left: pane.scrollLeft }),
      );
    } catch (_err) {
      /* ignore */
    }
  }

  function syncLayout(state) {
    var active = isActive(state);
    document.body.classList.toggle("x14-focus-mode", active);
    var app = document.querySelector(".legacy-app");
    if (app) {
      app.classList.toggle("x14-focus-active", active);
    }
    var frame = document.querySelector(".legacy-frame");
    var content = document.querySelector(".legacy-content");
    if (frame) {
      if (active) {
        if (!frame.dataset.x14MarginSaved) {
          frame.dataset.x14MarginSaved = "1";
          frame.dataset.x14MarginLeft = frame.style.marginLeft || "";
          frame.dataset.x14FrameWidth = frame.style.width || "";
          frame.dataset.x14FrameMaxWidth = frame.style.maxWidth || "";
        }
        frame.style.setProperty("margin-left", "0", "important");
        frame.style.setProperty("width", "100%", "important");
        frame.style.setProperty("max-width", "100%", "important");
      } else if (frame.dataset.x14MarginSaved) {
        frame.style.removeProperty("margin-left");
        frame.style.removeProperty("width");
        frame.style.removeProperty("max-width");
        if (frame.dataset.x14MarginLeft) {
          frame.style.marginLeft = frame.dataset.x14MarginLeft;
        }
        if (frame.dataset.x14FrameWidth) {
          frame.style.width = frame.dataset.x14FrameWidth;
        }
        if (frame.dataset.x14FrameMaxWidth) {
          frame.style.maxWidth = frame.dataset.x14FrameMaxWidth;
        }
        delete frame.dataset.x14MarginSaved;
      }
    }
    if (content) {
      if (active) {
        if (!content.dataset.x14ContentSaved) {
          content.dataset.x14ContentSaved = "1";
          content.dataset.x14ContentWidth = content.style.width || "";
          content.dataset.x14ContentMaxWidth = content.style.maxWidth || "";
          content.dataset.x14ContentMargin = content.style.margin || "";
        }
        content.style.width = "100%";
        content.style.maxWidth = "none";
        content.style.margin = "0";
      } else if (content.dataset.x14ContentSaved) {
        content.style.width = content.dataset.x14ContentWidth || "";
        content.style.maxWidth = content.dataset.x14ContentMaxWidth || "";
        content.style.margin = content.dataset.x14ContentMargin || "";
        delete content.dataset.x14ContentSaved;
      }
    }
    var host = document.getElementById("v3-focus-host");
    var tableWrap = document.querySelector(".clients-table-wrap");
    var cards = document.getElementById("clients-cards");
    var pagination = document.getElementById("pagination");
    if (host) {
      host.classList.toggle("clients-hidden", !active);
    }
    if (tableWrap) {
      tableWrap.classList.toggle("clients-hidden", active);
    }
    if (cards) {
      cards.classList.toggle("clients-hidden", active);
    }
    if (pagination) {
      pagination.classList.toggle("clients-hidden", active);
    }
  }

  function rulesForField(state, field) {
    return (state.v3Rules || []).filter(function (r) {
      return r.field === field;
    });
  }

  function enumEqValue(state, spec) {
    var eq = rulesForField(state, spec.field).find(function (r) {
      return r.op === "eq";
    });
    return eq && eq.value ? eq.value : "";
  }

  function captureFocusEnumDrafts(state, rootEl) {
    var drafts = {};
    if (!rootEl) {
      return drafts;
    }
    var userPicks = window.__v3FocusEnumUserPick || {};
    rootEl.querySelectorAll('[data-focus-kind="enum"]').forEach(function (sel) {
      if (!sel.isConnected) {
        return;
      }
      var colId = sel.getAttribute("data-focus-col") || "";
      var spec = COL_FILTER[colId];
      if (!spec || spec.input !== "enum") {
        return;
      }
      var committed = enumEqValue(state, spec);
      var domVal = sel.value || "";
      if (domVal === committed) {
        return;
      }
      var fromUser = userPicks[colId] === domVal || document.activeElement === sel;
      if (!fromUser) {
        return;
      }
      drafts[colId] = domVal;
    });
    return drafts;
  }

  function rememberFocusEnumUserPick(colId, value) {
    if (!colId) {
      return;
    }
    if (!window.__v3FocusEnumUserPick) {
      window.__v3FocusEnumUserPick = {};
    }
    window.__v3FocusEnumUserPick[colId] = value;
  }

  function clearFocusEnumUserPick(colId) {
    if (!window.__v3FocusEnumUserPick || !colId) {
      return;
    }
    delete window.__v3FocusEnumUserPick[colId];
  }

  function flushFocusEnumDrafts(enumDrafts, reload) {
    if (!enumDrafts || !window.ClientsV3) {
      return;
    }
    var keys = Object.keys(enumDrafts);
    if (!keys.length) {
      return;
    }
    var next = window.ClientsV3.readState();
    var editor = null;
    var changed = false;
    keys.forEach(function (colId) {
      var spec = COL_FILTER[colId];
      if (!spec || spec.input !== "enum") {
        return;
      }
      var draftVal = enumDrafts[colId];
      var committed = enumEqValue(next, spec);
      if (draftVal === committed) {
        return;
      }
      editor = {
        colId: colId,
        kind: "enum",
        value: draftVal,
        op: "contains",
        id: filterControlId(colId, "enum"),
      };
      var applied = applyEditor(next, editor);
      if (!applied) {
        return;
      }
      next = applied;
      changed = true;
    });
    if (!changed) {
      return;
    }
    next.page = 1;
    if (window.ClientsV3FieldRules) {
      window.ClientsV3FieldRules.syncLegacyFromRules(next);
    }
    reload(window.ClientsV3.mergeListStateForUserAction(next), editor);
    keys.forEach(function (colId) {
      clearFocusEnumUserPick(colId);
    });
  }

  function colValue(state, key) {
    return state[key] || "";
  }

  function hasColFilter(state, colId) {
    var spec = COL_FILTER[colId];
    if (!spec) {
      return false;
    }
    if (spec.kind === "col") {
      return Boolean(colValue(state, spec.key));
    }
    if (spec.input === "number") {
      return rulesForField(state, spec.field).some(function (r) {
        return r.op === "gte" || r.op === "lte" || r.op === "eq";
      });
    }
    if (spec.input === "bool") {
      return rulesForField(state, spec.field).length > 0;
    }
    return rulesForField(state, spec.field).some(function (r) {
      return r.op === spec.op || r.op === "eq" || r.op === "contains";
    });
  }

  function renderFilterControl(shell, col, state, filterOptions, enumDraftValue) {
    var spec = COL_FILTER[col.id];
    if (!spec) {
      return "";
    }
    if (spec.kind === "col") {
      var val = colValue(state, spec.key);
      return (
        '<input type="search" id="' +
        filterControlId(col.id, "col") +
        '" data-focus-col="' +
        shell.escapeHtml(col.id) +
        '" data-focus-kind="col" value="' +
        shell.escapeHtml(val) +
        '" placeholder="Содержит…" aria-label="Фильтр: ' +
        shell.escapeHtml(col.label) +
        '">'
      );
    }
    if (spec.input === "bool") {
      var yes = rulesForField(state, spec.field).some(function (r) {
        return r.op === "yes";
      });
      var no = rulesForField(state, spec.field).some(function (r) {
        return r.op === "no";
      });
      var selected = yes ? "yes" : no ? "no" : "";
      var empty = rulesForField(state, spec.field).some(function (r) {
        return r.op === "empty";
      });
      var filled = rulesForField(state, spec.field).some(function (r) {
        return r.op === "filled";
      });
      if (empty) selected = "empty";
      if (filled) selected = "filled";
      return (
        '<select id="' +
        filterControlId(col.id, "bool") +
        '" data-focus-col="' +
        shell.escapeHtml(col.id) +
        '" data-focus-kind="bool" aria-label="Фильтр: ' +
        shell.escapeHtml(col.label) +
        '">' +
        '<option value="">Все</option>' +
        '<option value="yes"' +
        (selected === "yes" ? " selected" : "") +
        ">Да</option>" +
        '<option value="no"' +
        (selected === "no" ? " selected" : "") +
        ">Нет</option>" +
        '<option value="empty"' +
        (selected === "empty" ? " selected" : "") +
        ">Не передано</option>" +
        '<option value="filled"' +
        (selected === "filled" ? " selected" : "") +
        ">Передано</option>" +
        "</select>"
      );
    }
    if (spec.input === "enum") {
      var eq = rulesForField(state, spec.field).find(function (r) {
        return r.op === "eq";
      });
      var selectedEnumValue = eq && eq.value ? eq.value : "";
      if (typeof enumDraftValue === "string") {
        selectedEnumValue = enumDraftValue;
      }
      var options = (filterOptions && filterOptions[spec.optionsKey]) || [];
      var optionsStatus = window.__lktandoorFilterOptionsStatus || "ok";
      if (!options.length && optionsStatus === "loading") {
        return (
          '<select disabled id="' +
          filterControlId(col.id, "enum") +
          '" data-focus-col="' +
          shell.escapeHtml(col.id) +
          '" data-focus-kind="enum" data-focus-options-state="loading" aria-label="Фильтр: ' +
          shell.escapeHtml(col.label) +
          '"><option value="">Загрузка…</option></select>'
        );
      }
      if (!options.length && optionsStatus === "error") {
        return (
          '<select disabled id="' +
          filterControlId(col.id, "enum") +
          '" data-focus-col="' +
          shell.escapeHtml(col.id) +
          '" data-focus-kind="enum" data-focus-options-state="error" aria-label="Фильтр: ' +
          shell.escapeHtml(col.label) +
          '"><option value="">Не удалось загрузить</option></select>'
        );
      }
      return (
        '<select id="' +
        filterControlId(col.id, "enum") +
        '" data-focus-col="' +
        shell.escapeHtml(col.id) +
        '" data-focus-kind="enum" aria-label="Фильтр: ' +
        shell.escapeHtml(col.label) +
        '"><option value="">Все</option>' +
        options
          .map(function (entry) {
            var value = entry.guid || entry.value || "";
            var label = entry.name || entry.value || value;
            return (
              '<option value="' +
              shell.escapeHtml(value) +
              '"' +
              (selectedEnumValue === value ? " selected" : "") +
              ">" +
              shell.escapeHtml(String(label)) +
              "</option>"
            );
          })
          .join("") +
        "</select>"
      );
    }
    if (spec.input === "number") {
      var gte = rulesForField(state, spec.field).find(function (r) {
        return r.op === "gte";
      });
      var lte = rulesForField(state, spec.field).find(function (r) {
        return r.op === "lte";
      });
      return (
        '<div class="x15-range">' +
        '<input type="number" step="any" inputmode="decimal" id="' +
        filterControlId(col.id, "number", "gte") +
        '" data-focus-col="' +
        shell.escapeHtml(col.id) +
        '" data-focus-kind="number" data-focus-op="gte" placeholder="От" value="' +
        shell.escapeHtml((gte && gte.value) || "") +
        '" aria-label="Фильтр: ' +
        shell.escapeHtml(col.label) +
        ' от">' +
        '<input type="number" step="any" inputmode="decimal" id="' +
        filterControlId(col.id, "number", "lte") +
        '" data-focus-col="' +
        shell.escapeHtml(col.id) +
        '" data-focus-kind="number" data-focus-op="lte" placeholder="До" value="' +
        shell.escapeHtml((lte && lte.value) || "") +
        '" aria-label="Фильтр: ' +
        shell.escapeHtml(col.label) +
        ' до">' +
        "</div>"
      );
    }
    var textRule = rulesForField(state, spec.field).find(function (r) {
      return r.op === (spec.op || "contains");
    });
    return (
      '<input type="search" id="' +
      filterControlId(col.id, "text") +
      '" data-focus-col="' +
      shell.escapeHtml(col.id) +
      '" data-focus-kind="text" value="' +
      shell.escapeHtml((textRule && textRule.value) || "") +
      '" placeholder="Содержит…" aria-label="Фильтр: ' +
      shell.escapeHtml(col.label) +
      '">'
    );
  }

  function renderHeader(shell, col, state, filterOptions, enumDrafts) {
    var filtered = hasColFilter(state, col.id);
    var draftVal = enumDrafts && enumDrafts[col.id];
    var control = renderFilterControl(
      shell,
      col,
      state,
      filterOptions,
      typeof draftVal === "string" ? draftVal : undefined,
    );
    return (
      '<th scope="col" class="' +
      (filtered ? "x15-filtered" : "") +
      '"><div class="x15-col-heading"><span>' +
      shell.escapeHtml(col.label) +
      "</span>" +
      (filtered
        ? '<button type="button" class="x15-clear-field" data-focus-clear-col="' +
          shell.escapeHtml(col.id) +
          '" aria-label="Сбросить фильтр: ' +
          shell.escapeHtml(col.label) +
          '" title="Сбросить условия по колонке">×</button>'
        : "") +
      "</div>" +
      control +
      "</th>"
    );
  }

  function activeFilterCount(state) {
    var n = state.q ? 1 : 0;
    n += (state.v3Rules || []).length;
    ["colManager", "colRegional", "colRop", "colCity", "colStatus"].forEach(function (key) {
      if (state[key]) {
        n += 1;
      }
    });
    return n;
  }

  function applyColClear(state, colId) {
    var spec = COL_FILTER[colId];
    if (!spec) {
      return state;
    }
    var next = Object.assign({}, state);
    if (spec.kind === "col") {
      next[spec.key] = "";
      return next;
    }
    next.v3Rules = (next.v3Rules || []).filter(function (r) {
      return r.field !== spec.field;
    });
    if (spec.field === "closed") {
      next.closed = "";
    }
    if (spec.field === "categoryGuid") {
      next.v3category = "";
      next.v3categories = [];
    }
    if (spec.field === "typeGuid") {
      next.v3type = "";
      next.v3types = [];
    }
    if (spec.field === "city") {
      next.city = "";
    }
    return next;
  }

  function buildFocusResetState() {
    return window.ClientsV3.mergeListStateForUserAction({
      q: "",
      page: 1,
      v3Rules: [],
      city: "",
      closed: "",
      colManager: "",
      colRegional: "",
      colRop: "",
      colCity: "",
      colStatus: "",
      v3types: [],
      v3categories: [],
      v3type: "",
      v3category: "",
    });
  }

  function applyEditor(state, editor) {
    var spec = COL_FILTER[editor.colId];
    if (!spec) {
      return state;
    }
    var next = Object.assign({}, state);
    next.v3Rules = (next.v3Rules || []).slice();
    if (spec.kind === "col") {
      next[spec.key] = editor.value || "";
      return next;
    }
    if (spec.input === "number") {
      if (editor.badInput) {
        return null;
      }
      var trimmed = String(editor.value || "").trim();
      if (trimmed === "" || trimmed === "-") {
        next.v3Rules = next.v3Rules.filter(function (r) {
          return !(r.field === spec.field && r.op === editor.op);
        });
        return next;
      }
      var normalized =
        window.ClientsV3FilterNumber && window.ClientsV3FilterNumber.normalizeListFilterNumberValue
          ? window.ClientsV3FilterNumber.normalizeListFilterNumberValue(trimmed)
          : { ok: false, reason: "invalid" };
      if (!normalized.ok) {
        return null;
      }
      next.v3Rules = next.v3Rules.filter(function (r) {
        return !(r.field === spec.field && r.op === editor.op);
      });
      next.v3Rules.push({ field: spec.field, op: editor.op, value: normalized.value });
      return next;
    }
    next.v3Rules = next.v3Rules.filter(function (r) {
      if (r.field !== spec.field) {
        return true;
      }
      if (spec.input === "bool") {
        return false;
      }
      return r.op !== (spec.op || "contains") && r.op !== "eq";
    });
    if (spec.input === "bool") {
      if (editor.value === "yes" || editor.value === "no" || editor.value === "empty" || editor.value === "filled") {
        next.v3Rules.push({ field: spec.field, op: editor.value, value: "" });
      }
      if (spec.field === "closed") {
        if (editor.value === "yes") next.closed = "true";
        else if (editor.value === "no") next.closed = "false";
        else next.closed = "";
      }
      return next;
    }
    if (spec.input === "enum") {
      if (editor.value) {
        next.v3Rules.push({ field: spec.field, op: "eq", value: editor.value });
      }
      if (spec.field === "categoryGuid") {
        next.v3category = editor.value || "";
        next.v3categories = editor.value ? [editor.value] : [];
      }
      if (spec.field === "typeGuid") {
        next.v3type = editor.value || "";
        next.v3types = editor.value ? [editor.value] : [];
      }
      return next;
    }
    var text = String(editor.value || "").trim();
    if (text) {
      next.v3Rules.push({ field: spec.field, op: spec.op || "contains", value: text });
    }
    if (spec.field === "city") {
      next.city = text;
    }
    return next;
  }

  function bindFocusChromeControls(payload, pane) {
    var state = payload.state || {};
    document.getElementById("v3-focus-exit")?.addEventListener("click", function () {
      writeScroll(state, pane || document.getElementById("x14-focus-scroll"));
      if (payload.onExit) {
        payload.onExit();
      }
    });
    document.getElementById("v3-focus-reset")?.addEventListener("click", function () {
      if (payload.onReset) {
        payload.onReset();
      }
    });
    document.getElementById("v3-focus-retry-load")?.addEventListener("click", function () {
      if (payload.onRetry) {
        payload.onRetry();
      }
    });
    document.getElementById("v3-focus-columns")?.addEventListener("click", function () {
      if (window.ClientsV3 && window.ClientsV3.openLktandoorColumnsDialog) {
        var liveCtx = payload.ctx || window.__lktandoorListCtx || window.__lktandoorUiCtx;
        var liveState = window.ClientsV3.readState();
        window.ClientsV3.openLktandoorColumnsDialog(liveCtx, liveState);
      }
    });
    var search = document.getElementById("v3-focus-search");
    if (search) {
      search.addEventListener(
        "input",
        function () {
          if (!payload.onSearch) {
            return;
          }
          var caret = search.selectionStart;
          rememberFocusSearchUserPick(search.value || "");
          scheduleFocusSearchCommit(function (nextState) {
            payload.onSearch(nextState.q || "");
          }, search.value || "", caret);
        },
        { passive: true },
      );
    }
  }

  function renderFocusChrome(shell, state, bodyHtml, statusLine) {
    syncLayout(state);
    document.getElementById("results-content")?.classList.remove("clients-hidden");
    document.getElementById("results-state")?.classList.add("clients-hidden");
    var host = document.getElementById("v3-focus-host");
    if (!host) {
      return null;
    }
    host.classList.remove("clients-hidden");
    var filterCount = activeFilterCount(state);
    var countLine = statusLine || "Загрузка…";
    host.innerHTML =
      '<div class="x14-focus" data-testid="v3-focus-root">' +
      '<div class="x14-focusbar">' +
      '<label class="x15-search"><input id="v3-focus-search" type="search" autocomplete="off" aria-label="Поиск в полноэкранном реестре" placeholder="Поиск по клиентам, адресам, контактам…" value="' +
      shell.escapeHtml(state.q || "") +
      '"></label>' +
      '<span role="status">' +
      shell.escapeHtml(countLine) +
      "</span>" +
      (filterCount
        ? '<button type="button" class="workspace-button workspace-button--ghost x15-reset" id="v3-focus-reset">Сбросить' +
          (filterCount > 1 ? " · " + filterCount : "") +
          "</button>"
        : "") +
      '<button type="button" class="workspace-button workspace-button--ghost" id="v3-focus-columns">Колонки</button>' +
      '<button type="button" class="workspace-button workspace-button--primary" id="v3-focus-exit">Выйти <kbd>Esc</kbd></button>' +
      "</div>" +
      bodyHtml +
      "</div>";
    return host;
  }

  function renderBlockingError(payload) {
    var shell = payload.shell;
    var state = payload.state || {};
    var title = payload.title || "Не удалось загрузить список";
    var message = payload.message || "";
    var body =
      '<div class="x14-focus-error" role="alert" data-testid="v3-focus-error">' +
      "<h3>" +
      shell.escapeHtml(title) +
      "</h3>" +
      "<p>" +
      shell.escapeHtml(message) +
      "</p>" +
      '<div class="x14-focus-error__actions">' +
      '<button type="button" class="workspace-button workspace-button--primary" id="v3-focus-retry-load">Повторить</button>' +
      "</div></div>";
    var host = renderFocusChrome(shell, state, body, payload.statusLine || "Ошибка загрузки");
    if (!host) {
      return;
    }
    bindFocusChromeControls(payload, null);
  }

  function patchEnumSelectOptions(selectEl, shell, colId, state, filterOptions) {
    var spec = COL_FILTER[colId];
    if (!spec || spec.input !== "enum") {
      return;
    }
    var options = (filterOptions && filterOptions[spec.optionsKey]) || [];
    var optionsStatus = window.__lktandoorFilterOptionsStatus || "ok";
    var eq = rulesForField(state, spec.field).find(function (r) {
      return r.op === "eq";
    });
    var stateValue = eq && eq.value ? eq.value : "";
    var domValue = selectEl.value || "";
    var isActive = document.activeElement === selectEl;
    var keepValue = isActive ? domValue : stateValue;
    if (!isActive && domValue && domValue !== stateValue) {
      var domInOptions = options.some(function (entry) {
        return (entry.guid || entry.value || "") === domValue;
      });
      if (domInOptions) {
        keepValue = domValue;
      }
    }
    var intent = window.__v3FocusEnumLastIntent;
    if (
      intent &&
      intent.colId === colId &&
      intent.resetEpoch === (window.__v3FocusSearchResetEpoch || 0) &&
      options.some(function (entry) {
        return (entry.guid || entry.value || "") === intent.value;
      })
    ) {
      keepValue = intent.value;
    }
    if (!options.length && optionsStatus === "loading") {
      return;
    }
    if (!options.length && optionsStatus === "error") {
      return;
    }
    selectEl.disabled = false;
    selectEl.removeAttribute("data-focus-options-state");
    selectEl.innerHTML =
      '<option value="">Все</option>' +
      options
        .map(function (entry) {
          var value = entry.guid || entry.value || "";
          var label = entry.name || entry.value || value;
          return (
            '<option value="' +
            shell.escapeHtml(value) +
            '"' +
            (stateValue === value ? " selected" : "") +
            ">" +
            shell.escapeHtml(String(label)) +
            "</option>"
          );
        })
        .join("");
    var hasKeep = Array.from(selectEl.options).some(function (opt) {
      return opt.value === keepValue;
    });
    if (keepValue && hasKeep) {
      selectEl.value = keepValue;
    } else if (stateValue) {
      selectEl.value = stateValue;
    } else {
      selectEl.value = "";
    }
  }

  function runApplyFromEditor(editor, ctx, shell, reload) {
    if (!editor) {
      return;
    }
    var colId = editor.colId || "";
    var kind = editor.kind || "";
    if (kind === "number" && editor.badInput) {
      restoreFilterEditor(editor);
      return;
    }
    var live = window.ClientsV3.readState();
    if (kind === "enum") {
      var enumSpec = COL_FILTER[colId];
      if (enumSpec && enumEqValue(live, enumSpec) === String(editor.value || "")) {
        delete window.__v3FocusEnumLastIntent;
        return;
      }
    }
    var next = applyEditor(live, editor);
      if (next === null) {
        window.ClientsLktandoorFocus.renderBlockingError({
          shell: shell,
          state: live,
          ctx: ctx,
          statusLine: "Недопустимое значение",
          title: "Недопустимое число",
          message:
            "Используйте обычный десятичный формат (например 1000 или 0.5). Значение не отправлено на сервер.",
          onRetry: function () {
            reload(live, editor);
          },
          onReset: function () {
            reload(buildFocusResetState(), null);
          },
          onExit: function () {
            reload(window.ClientsV3.mergeListStateForUserAction({ v3focus: false }), null);
          },
          onSearch: function (q) {
            reload(window.ClientsV3.mergeListStateForUserAction({ q: q, page: 1 }), editor);
          },
        });
        restoreFilterEditor(editor);
        return;
      }
      next.page = 1;
      if (window.ClientsV3FieldRules) {
        window.ClientsV3FieldRules.syncLegacyFromRules(next);
      }
    if (kind === "enum") {
      clearFocusEnumUserPick(colId);
      delete window.__v3FocusEnumLastIntent;
    }
    reload(window.ClientsV3.mergeListStateForUserAction(next), editor);
  }

  function flushPendingFocusEnumIntent(ctx, shell, reload) {
    var intent = window.__v3FocusEnumLastIntent;
    if (!intent || intent.kind !== "enum") {
      return;
    }
    if (intent.resetEpoch !== (window.__v3FocusSearchResetEpoch || 0)) {
      delete window.__v3FocusEnumLastIntent;
      return;
    }
    var spec = COL_FILTER[intent.colId];
    if (!spec) {
      delete window.__v3FocusEnumLastIntent;
      return;
    }
    var live = window.ClientsV3.readState();
    if (enumEqValue(live, spec) === String(intent.value || "")) {
      delete window.__v3FocusEnumLastIntent;
      return;
    }
    runApplyFromEditor(intent, ctx, shell, reload);
  }

  function bindFocusColumnEditor(input, ctx, shell, reload) {
    if (!input || input.dataset.focusEditorBound === "1") {
      return;
    }
    input.dataset.focusEditorBound = "1";
    function runApply(target) {
      var el = target || input;
      if (!el) {
        return;
      }
      var colId = el.getAttribute("data-focus-col") || "";
      var kind = el.getAttribute("data-focus-kind") || "";
      var editor = {
        colId: colId,
        kind: kind,
        value: el.value,
        op: el.getAttribute("data-focus-op") || "contains",
        id: el.id || filterControlId(colId, kind, el.getAttribute("data-focus-op") || undefined),
        position: el.selectionStart,
        badInput: kind === "number" && el.validity && el.validity.badInput,
      };
      runApplyFromEditor(editor, ctx, shell, reload);
    }
    function onEdit(immediate, target) {
      if (immediate) {
        clearTimeout(filterTimer);
        runApply(target);
        return;
      }
      clearTimeout(filterTimer);
      var el = target || input;
      filterTimer = setTimeout(function () {
        runApply(el);
      }, 180);
    }
    if (input.tagName === "SELECT") {
      var kind = input.getAttribute("data-focus-kind") || "";
      if (kind === "enum") {
        var enumApplyToken = 0;
        function scheduleEnumApply(evt) {
          var target = evt && evt.currentTarget ? evt.currentTarget : input;
          var colId = target.getAttribute("data-focus-col") || "";
          var snapshot = {
            colId: colId,
            kind: "enum",
            value: target.value || "",
            op: target.getAttribute("data-focus-op") || "contains",
            id: target.id || filterControlId(colId, "enum", target.getAttribute("data-focus-op") || undefined),
            resetEpoch: window.__v3FocusSearchResetEpoch || 0,
          };
          rememberFocusEnumUserPick(colId, snapshot.value);
          window.__v3FocusEnumLastIntent = snapshot;
          enumApplyToken += 1;
          var token = enumApplyToken;
          queueMicrotask(function () {
            if (token !== enumApplyToken) {
              return;
            }
            runApplyFromEditor(snapshot, ctx, shell, reload);
          });
        }
        input.addEventListener("input", scheduleEnumApply);
        input.addEventListener("change", scheduleEnumApply);
      } else {
        input.addEventListener("change", function (evt) {
          onEdit(true, evt.currentTarget);
        });
      }
    } else {
      input.addEventListener("input", function (evt) {
        onEdit(false, evt.currentTarget);
      });
    }
  }

  function bindFocusColumnEditors(host, ctx, shell, reload) {
    host.querySelectorAll("[data-focus-col]").forEach(function (input) {
      bindFocusColumnEditor(input, ctx, shell, reload);
    });
  }

  function refreshFilterMetadata(ctx, state, filterOptions) {
    if (!ctx || !ctx.shell) {
      return false;
    }
    var shell = ctx.shell;
    var host = document.getElementById("v3-focus-host");
    if (!host || host.classList.contains("clients-hidden")) {
      return false;
    }
    if (host.querySelector('[data-testid="v3-focus-error"]')) {
      return false;
    }
    var root = host.querySelector('[data-testid="v3-focus-root"]');
    if (!root) {
      return false;
    }
    var onState = window.__lastV3ListPayload && window.__lastV3ListPayload.onState;
    if (!onState) {
      return false;
    }
    function reload(nextState, editor) {
      onState(nextState, editor);
    }
    root.querySelectorAll('[data-focus-kind="enum"]').forEach(function (selectEl) {
      var colId = selectEl.getAttribute("data-focus-col") || "";
      patchEnumSelectOptions(selectEl, shell, colId, state, filterOptions || {});
      bindFocusColumnEditor(selectEl, ctx, shell, reload);
    });
    return true;
  }

  function render(ctx, payload) {
    if (!ctx || !ctx.shell) {
      return;
    }
    var shell = ctx.shell;
    var state = payload.state;
    var items = payload.items || [];
    var total = payload.total || 0;
    var visibleCols = payload.visibleCols || [];
    var filterOptions = payload.filterOptions || {};
    var host = document.getElementById("v3-focus-host");
    if (!host) {
      return;
    }
    function earlyReload(nextState, editor) {
      if (payload.onState) {
        payload.onState(nextState, editor);
      }
    }
    flushScheduledFocusSearchCommit(earlyReload);
    flushPendingFocusEnumIntent(ctx, shell, earlyReload);
    state = payload.state || window.ClientsV3.readState();
    syncLayout(state);
    var scroll = readScroll(state);
    var matched = total;
    var countLine =
      window.ClientsLktandoorList && window.ClientsLktandoorList.formatResultCountLine
        ? window.ClientsLktandoorList.formatResultCountLine(state, matched)
        : "Совпало " + matched;
    var tableMin = 200 + Math.max(0, visibleCols.length - 1) * 120;
    var isGrouped = state.v3entity === "legal_grouped";
    var listUi = window.ClientsV3List;
    var detailType = payload.detailType || "legal";
    var filterCount = activeFilterCount(state);
    var searchDraft = null;
    var existingSearch = document.getElementById("v3-focus-search");
    if (existingSearch) {
      var committedQ = String(state.q || "").trim();
      var draftQ = existingSearch.value || "";
      if (draftQ !== committedQ) {
        var userPick = window.__v3FocusSearchUserPick;
        var fromUser =
          document.activeElement === existingSearch ||
          (typeof userPick === "string" && userPick === draftQ);
        if (fromUser) {
          searchDraft = {
            value: draftQ,
            start: existingSearch.selectionStart,
            end: existingSearch.selectionEnd,
          };
        }
      }
    }
    if (!searchDraft && window.__v3FocusSearchDebounceSnap) {
      var snap = window.__v3FocusSearchDebounceSnap;
      if (snap.resetEpoch === (window.__v3FocusSearchResetEpoch || 0)) {
        searchDraft = {
          value: snap.value,
          start: snap.caret,
          end: snap.caret,
        };
      }
    }
    var searchValue = searchDraft ? searchDraft.value : state.q || "";
    var enumDrafts = captureFocusEnumDrafts(state, host);
    host.innerHTML =
      '<div class="x14-focus" data-testid="v3-focus-root">' +
      '<div class="x14-focusbar">' +
      '<label class="x15-search"><input id="v3-focus-search" type="search" autocomplete="off" aria-label="Поиск в полноэкранном реестре" placeholder="Поиск по клиентам, адресам, контактам…" value="' +
      shell.escapeHtml(searchValue) +
      '"></label>' +
      '<span role="status">' +
      shell.escapeHtml(countLine) +
      "</span>" +
      (filterCount
        ? '<button type="button" class="workspace-button workspace-button--ghost x15-reset" id="v3-focus-reset">Сбросить' +
          (filterCount > 1 ? " · " + filterCount : "") +
          "</button>"
        : "") +
      '<button type="button" class="workspace-button workspace-button--ghost" id="v3-focus-columns">Колонки</button>' +
      '<button type="button" class="workspace-button workspace-button--primary" id="v3-focus-exit">Выйти <kbd>Esc</kbd></button>' +
      "</div>" +
      '<div class="x14-focus-scroll" id="x14-focus-scroll" role="region" aria-label="Полнооконный список клиентов" tabindex="0">' +
      '<table aria-label="Клиентская база" style="--focus-table-min:' +
      tableMin +
      'px"><thead><tr>' +
      visibleCols.map(function (col) {
        return renderHeader(shell, col, state, filterOptions, enumDrafts);
      }).join("") +
      "</tr></thead><tbody>" +
      (items.length
        ? items
            .map(function (item) {
              var rowDetail = item.detail_entity || detailType;
              var href =
                window.ClientsV3 && window.ClientsV3.detailHref
                  ? window.ClientsV3.detailHref(item.guid, rowDetail, state)
                  : "/clients/" + encodeURIComponent(item.guid);
              return (
                "<tr>" +
                visibleCols
                  .map(function (col, index) {
                    var cellHtml = listUi ? listUi.cellDisplay(item, col.id, shell, state, isGrouped) : "—";
                    if (index === 0) {
                      if (cellHtml.indexOf("<a ") !== -1) {
                        return '<td><span class="x14-cell-content">' + cellHtml + "</span></td>";
                      }
                      return (
                        '<td><a class="clients-link x14-cell-content" href="' +
                        shell.escapeHtml(href) +
                        '">' +
                        cellHtml.replace(/<[^>]+>/g, "") +
                        "</a></td>"
                      );
                    }
                    return '<td><span class="x14-cell-content">' + cellHtml + "</span></td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("")
        : '<tr class="x15-empty"><td colspan="' +
          visibleCols.length +
          '"><h3>Нет совпадений</h3><p>Измените поиск или условия в заголовках колонок.</p>' +
          (filterCount
            ? '<button type="button" class="workspace-button workspace-button--ghost" id="v3-focus-reset-empty">Сбросить поиск и фильтры</button>'
            : "") +
          "</td></tr>") +
      "</tbody></table></div>" +
      '<div class="x14-focus-pagination" id="v3-focus-pagination"></div></div>';

    var pane = document.getElementById("x14-focus-scroll");
    if (pane) {
      pane.scrollTop = scroll.top || 0;
      pane.scrollLeft = scroll.left || 0;
      pane.addEventListener(
        "scroll",
        function () {
          writeScroll(state, pane);
        },
        { passive: true },
      );
    }

    function reload(nextState, editor) {
      writeScroll(state, pane);
      payload.onState(nextState, editor);
    }

    var pageSize = state.pageSize || 50;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    var pagEl = document.getElementById("v3-focus-pagination");
    if (pagEl) {
      if (totalPages <= 1) {
        pagEl.innerHTML = "";
      } else {
        var prevDisabled = state.page <= 1;
        var nextDisabled = state.page >= totalPages;
        pagEl.innerHTML =
          '<button type="button" class="workspace-button workspace-button--secondary" id="v3-focus-page-prev"' +
          (prevDisabled ? " disabled" : "") +
          ">Назад</button><span>Страница " +
          state.page +
          " из " +
          totalPages +
          '</span><button type="button" class="workspace-button workspace-button--secondary" id="v3-focus-page-next"' +
          (nextDisabled ? " disabled" : "") +
          ">Вперёд</button>";
        document.getElementById("v3-focus-page-prev")?.addEventListener("click", function () {
          if (state.page <= 1) {
            return;
          }
          writeScroll(state, pane);
          reload(window.ClientsV3.mergeListStateForUserAction({ page: state.page - 1 }), null);
        });
        document.getElementById("v3-focus-page-next")?.addEventListener("click", function () {
          if (state.page >= totalPages) {
            return;
          }
          writeScroll(state, pane);
          reload(window.ClientsV3.mergeListStateForUserAction({ page: state.page + 1 }), null);
        });
      }
    }

    document.getElementById("v3-focus-exit")?.addEventListener("click", function () {
      writeScroll(state, pane);
      reload(window.ClientsV3.mergeListStateForUserAction({ v3focus: false }), null);
    });
    document.getElementById("v3-focus-columns")?.addEventListener("click", function () {
      if (window.ClientsV3 && window.ClientsV3.openLktandoorColumnsDialog) {
        var liveCtx = window.__lktandoorListCtx || window.__lktandoorUiCtx || ctx;
        var liveState = window.ClientsV3.readState();
        window.ClientsV3.openLktandoorColumnsDialog(liveCtx, liveState);
      }
    });
    function resetAll() {
      prepareFocusExplicitReset();
      var next = buildFocusResetState();
      reload(next, null);
    }
    document.getElementById("v3-focus-reset")?.addEventListener("click", resetAll);
    document.getElementById("v3-focus-reset-empty")?.addEventListener("click", resetAll);

    var searchEl = document.getElementById("v3-focus-search");
    if (searchEl) {
      if (searchDraft && searchEl.setSelectionRange) {
        var start = typeof searchDraft.start === "number" ? searchDraft.start : searchDraft.value.length;
        searchEl.setSelectionRange(start, typeof searchDraft.end === "number" ? searchDraft.end : start);
      }
      searchEl.addEventListener("input", function () {
        var el = searchEl;
        rememberFocusSearchUserPick(el.value || "");
        scheduleFocusSearchCommit(reload, el.value || "", el.selectionStart);
      });
    }

    host.querySelectorAll("[data-focus-clear-col]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var colId = btn.getAttribute("data-focus-clear-col") || "";
        reload(applyColClear(window.ClientsV3.readState(), colId), null);
      });
    });

    bindFocusColumnEditors(host, ctx, shell, reload);
    flushFocusEnumDrafts(enumDrafts, reload);

    var editorForRestore = null;
    if (
      payload.loadGeneration == null ||
      window.__v3FocusEditorGeneration === payload.loadGeneration
    ) {
      editorForRestore = payload.editor != null ? payload.editor : window.__v3FocusEditor || null;
    }
    restoreFilterEditor(editorForRestore);
  }

  function bindGlobal() {
    if (window.__lktandoorFocusBound) {
      return;
    }
    window.__lktandoorFocusBound = true;
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") {
        return;
      }
      var dialog = document.getElementById("v3-lktandoor-columns-dialog");
      if (dialog && dialog.open) {
        event.preventDefault();
        window.ClientsV3?.closeLktandoorColumnsDialog();
        return;
      }
      var state = window.ClientsV3?.readState();
      if (!state || !state.v3focus) {
        return;
      }
      var listCtx = window.__lktandoorListCtx || window.__lktandoorUiCtx;
      if (!listCtx || !listCtx.api || !window.ClientsV3) {
        return;
      }
      event.preventDefault();
      writeScroll(state, document.getElementById("x14-focus-scroll"));
      window.ClientsV3.loadList(
        listCtx,
        window.ClientsV3.mergeListStateForUserAction({ v3focus: false }),
        true,
      );
    });
  }

  window.ClientsLktandoorFocus = {
    isActive: isActive,
    syncLayout: syncLayout,
    render: render,
    renderBlockingError: renderBlockingError,
    buildFocusResetState: buildFocusResetState,
    prepareExplicitReset: prepareFocusExplicitReset,
    bindGlobal: bindGlobal,
    captureScroll: function (state) {
      writeScroll(state, document.getElementById("x14-focus-scroll"));
    },
    refreshFilterMetadata: refreshFilterMetadata,
  };
})();
