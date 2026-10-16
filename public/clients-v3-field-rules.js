(function () {
  "use strict";

  var fieldsCache = {};
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parseRulesFromState(state) {
    if (state.v3Rules && Array.isArray(state.v3Rules)) {
      return state.v3Rules.slice();
    }
    return [];
  }

  function serializeRules(rules) {
    return JSON.stringify(rules || []);
  }

  function syncLegacyFromRules(state) {
    var rules = parseRulesFromState(state);
    state.v3Rules = rules;
    var cat = rules.find(function (r) {
      return r.field === "categoryGuid" && r.op === "eq" && r.value;
    });
    state.v3category = cat ? cat.value : "";
    state.v3categories = cat ? [cat.value] : [];
    var typ = rules.find(function (r) {
      return r.field === "typeGuid" && r.op === "eq" && r.value;
    });
    state.v3type = typ ? typ.value : "";
    state.v3types = typ ? [typ.value] : [];
    var cityRule = rules.find(function (r) {
      return r.field === "city" && r.op === "eq" && r.value;
    });
    state.city = cityRule ? cityRule.value : "";
    // Manager selection is territory state, not an alias of a removable rule.
    var closedYes = rules.some(function (r) {
      return r.field === "closed" && r.op === "yes";
    });
    var closedNo = rules.some(function (r) {
      return r.field === "closed" && r.op === "no";
    });
    if (closedYes) state.closed = "true";
    else if (closedNo) state.closed = "false";
    else state.closed = "";
    state.missingManager = rules.some(function (r) {
      return r.field === "missingManager" && r.op === "yes";
    });
    return state;
  }

  function mergeRulesFromLegacy(state) {
    var rules = parseRulesFromState(state);
    function upsertEq(field, value) {
      rules = rules.filter(function (r) {
        return r.field !== field;
      });
      if (!value) {
        return;
      }
      rules.push({ field: field, op: "eq", value: value });
    }
    if (!rules.some(function (r) { return r.field === "city"; })) {
      upsertEq("city", state.city || "");
    }
    if (!rules.some(function (r) { return r.field === "closed"; }) && state.closed) {
      rules.push({ field: "closed", op: state.closed === "true" ? "yes" : "no", value: "" });
    }
    var cats = state.v3categories && state.v3categories.length ? state.v3categories : state.v3category ? [state.v3category] : [];
    if (cats[0]) {
      upsertEq("categoryGuid", cats[0]);
    }
    var types = state.v3types && state.v3types.length ? state.v3types : state.v3type ? [state.v3type] : [];
    if (types[0]) {
      upsertEq("typeGuid", types[0]);
    }
    state.v3Rules = rules.slice(0, 12);
    return syncLegacyFromRules(state);
  }

  function opLabel(op) {
    return (
      {
        empty: "не заполнено",
        filled: "заполнено",
        yes: "Да",
        no: "Нет",
        eq: "=",
        contains: "содержит",
        gte: "от",
        lte: "до",
      }[op] || op
    );
  }

  function resolveLabel(fieldId, options) {
    var fields = fieldsCache[options.entity] || [];
    var def = fields.find(function (f) {
      return f.id === fieldId;
    });
    return def ? def.label : fieldId;
  }

  function valueLabel(fieldId, value, options) {
    if (!value) {
      return "";
    }
    if (options.staff && options.staff[fieldId]) {
      var employee = options.staff[fieldId].find(function (entry) { return entry.guid === value; });
      if (employee) return employee.name;
    }
    if (fieldId === "categoryGuid" && options.categories) {
      var cat = options.categories.find(function (c) {
        return c.guid === value;
      });
      if (cat) return cat.name;
    }
    if (fieldId === "typeGuid" && options.types) {
      var tp = options.types.find(function (t) {
        return t.guid === value;
      });
      if (tp) return tp.name;
    }
    if (fieldId === "managerGuid" && options.managers) {
      var m = options.managers.find(function (x) {
        return x.guid === value;
      });
      if (m) return m.name;
    }
    return value;
  }

  function renderChips(shell, state, options, onRemove) {
    var chipsEl = document.getElementById("v3-lktandoor-filter-chips");
    var summary = document.getElementById("v3-lktandoor-filter-summary");
    if (!chipsEl || !summary) {
      return;
    }
    var rules = parseRulesFromState(state);
    summary.textContent = "Фильтры по всем полям · " + rules.length;
    chipsEl.innerHTML = rules
      .map(function (rule, index) {
        var label =
          resolveLabel(rule.field, options) +
          ": " +
          opLabel(rule.op) +
          (rule.value ? " " + valueLabel(rule.field, rule.value, options) : "");
        return (
          '<button type="button" class="x6-chip" data-v3-rule-remove="' +
          index +
          '" data-testid="v3-rule-chip">' +
          shell.escapeHtml(label) +
          " ×</button>"
        );
      })
      .join("");
    chipsEl.querySelectorAll("[data-v3-rule-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-v3-rule-remove"));
        onRemove(idx);
      });
    });
  }

  function loadFields(api, entity) {
    if (fieldsCache[entity]) {
      return Promise.resolve(fieldsCache[entity]);
    }
    return api
      .apiRequest("/api/clients/v3/filter-fields?entity=" + encodeURIComponent(entity))
      .then(function (res) {
        if (res.response.ok && res.data && res.data.fields) {
          fieldsCache[entity] = res.data.fields;
          return res.data.fields;
        }
        return [];
      });
  }

  function syncOperatorSelect(fieldDef, opSelect) {
    if (!opSelect || !fieldDef) {
      return;
    }
    var ops = fieldDef.ops || [];
    var prev = opSelect.value;
    opSelect.innerHTML = ops
      .map(function (op) {
        return '<option value="' + op + '">' + opLabel(op) + "</option>";
      })
      .join("");
    if (ops.indexOf(prev) !== -1) {
      opSelect.value = prev;
    }
  }

  function syncValueControl(fieldDef, op, options, currentValue) {
    var wrap = document.getElementById("v3-rule-value-wrap");
    if (!wrap || !fieldDef) {
      return;
    }
    if (["empty", "filled", "yes", "no"].indexOf(op) !== -1) {
      wrap.innerHTML = '<input id="v3-rule-value" class="clients-field__input" disabled placeholder="—">';
      return;
    }
    if (fieldDef.id === "categoryGuid") {
      var catHtml = '<select id="v3-rule-value" class="clients-field__select"><option value="">—</option>';
      (options.categories || []).forEach(function (c) {
        catHtml +=
          '<option value="' +
          esc(c.guid) +
          '"' +
          (currentValue === c.guid ? " selected" : "") +
          ">" +
          esc(c.guid) +
          " · " +
          esc(c.name) +
          "</option>";
      });
      wrap.innerHTML = catHtml + "</select>";
      return;
    }
    if (fieldDef.id === "typeGuid") {
      var typeHtml = '<select id="v3-rule-value" class="clients-field__select"><option value="">—</option>';
      (options.types || []).forEach(function (t) {
        typeHtml +=
          '<option value="' +
          esc(t.guid) +
          '"' +
          (currentValue === t.guid ? " selected" : "") +
          ">" +
          esc(t.guid) +
          " · " +
          esc(t.name) +
          "</option>";
      });
      wrap.innerHTML = typeHtml + "</select>";
      return;
    }
    if (fieldDef.kind === "guid") {
      var mgrHtml = '<select id="v3-rule-value" class="clients-field__select"><option value="">—</option>';
      ((options.staff && options.staff[fieldDef.id]) || options.managers || []).forEach(function (m) {
        mgrHtml +=
          '<option value="' +
          esc(m.guid) +
          '"' +
          (currentValue === m.guid ? " selected" : "") +
          ">" +
          esc(m.name) +
          "</option>";
      });
      wrap.innerHTML = mgrHtml + "</select>";
      return;
    }
    wrap.innerHTML =
      '<input id="v3-rule-value" class="clients-field__input" type="' + (fieldDef.kind === "number" ? "number" : "text") + '" step="any" value="' +
      esc(currentValue || "") +
      '">';
  }

  function renderBuilder(shell, entity, options) {
    var fieldSelect = document.getElementById("v3-rule-field");
    var opSelect = document.getElementById("v3-rule-op");
    if (!fieldSelect) {
      return;
    }
    var fields = fieldsCache[entity] || [];
    fieldSelect.innerHTML = fields
      .map(function (f) {
        return (
          '<option value="' +
          shell.escapeHtml(f.id) +
          '">' +
          shell.escapeHtml(f.label) +
          (f.unavailableNote ? " · ограничено" : "") +
          "</option>"
        );
      })
      .join("");
    var noteEl = document.getElementById("v3-rule-field-note");
    function refreshValue() {
      var def = fields.find(function (f) {
        return f.id === fieldSelect.value;
      });
      syncOperatorSelect(def, opSelect);
      syncValueControl(def, opSelect.value, options, "");
      if (noteEl) {
        noteEl.textContent = def && def.unavailableNote ? def.unavailableNote : "";
      }
    }
    fieldSelect.onchange = refreshValue;
    opSelect.onchange = function () {
      var def = fields.find(function (f) {
        return f.id === fieldSelect.value;
      });
      syncValueControl(def, opSelect.value, options, "");
    };
    refreshValue();
  }

  var FIELD_SHORTCUTS = [
    { label: "ТОП", fieldId: "categoryGuid", op: "filled" },
    { label: "Юрлицо", fieldId: "legalName", op: "contains", entities: ["legal", "legal_grouped"] },
    { label: "ИНН", fieldId: "inn", op: "contains", entities: ["legal", "legal_grouped"] },
    {
      label: "Договор",
      unavailable:
        "Договор не поддержан в контракте фильтров списка v3. Запрос к 1С — см. docs/delivery/f4-contract-source-blocker.md.",
    },
    { label: "ЛПР", fieldId: "lprName", op: "contains", entities: ["retail", "orphan_retail"] },
    { label: "Бонус Club", fieldId: "clubBonus", op: "contains", entities: ["retail", "orphan_retail"] },
    { label: "День приёмки", fieldId: "loadingOnMonday", op: "yes", entities: ["retail", "orphan_retail"] },
  ];

  function entityBucket(entity) {
    if (entity === "legal_grouped" || entity === "holdings") {
      return "legal_grouped";
    }
    if (entity === "legal") {
      return "legal";
    }
    return entity;
  }

  function shortcutEnabled(shortcut, entity, fields) {
    if (shortcut.unavailable) {
      return false;
    }
    if (shortcut.entities && shortcut.entities.indexOf(entityBucket(entity)) === -1) {
      return false;
    }
    return (fields || []).some(function (f) {
      return f.id === shortcut.fieldId;
    });
  }

  function renderFieldShortcuts(shell, entity, onSelect) {
    var host = document.getElementById("v3-lktandoor-field-shortcuts");
    if (!host) {
      return;
    }
    var fields = fieldsCache[entity] || fieldsCache.legal_grouped || [];
    host.innerHTML = FIELD_SHORTCUTS.map(function (shortcut) {
      var enabled = shortcutEnabled(shortcut, entity, fields);
      var title = shortcut.unavailable || "";
      if (!enabled && !title && shortcut.entities) {
        title = "Недоступно для текущего реестра";
      }
      return (
        '<button type="button" class="x6-field-shortcut' +
        (enabled ? "" : " x6-field-shortcut--disabled") +
        '" data-v3-field-shortcut="' +
        esc(shortcut.fieldId || "") +
        '" data-v3-field-op="' +
        esc(shortcut.op || "contains") +
        '"' +
        (enabled ? "" : " disabled") +
        (title ? ' title="' + esc(title) + '"' : "") +
        ">" +
        esc(shortcut.label) +
        "</button>"
      );
    }).join("");
    host.querySelectorAll("[data-v3-field-shortcut]").forEach(function (btn) {
      if (btn.disabled) {
        return;
      }
      btn.addEventListener("click", function () {
        onSelect(btn.getAttribute("data-v3-field-shortcut") || "", btn.getAttribute("data-v3-field-op") || "contains");
      });
    });
  }

  window.ClientsV3FieldRules = {
    parseRulesFromState: parseRulesFromState,
    serializeRules: serializeRules,
    syncLegacyFromRules: syncLegacyFromRules,
    mergeRulesFromLegacy: mergeRulesFromLegacy,
    renderChips: renderChips,
    loadFields: loadFields,
    renderBuilder: renderBuilder,
    renderFieldShortcuts: renderFieldShortcuts,
    appendRulesToParams: function (params, state) {
      var rules = parseRulesFromState(state);
      if (rules.length) {
        params.set("filters", serializeRules(rules));
      } else {
        params.delete("filters");
      }
    },
    readRulesFromUrl: function (search) {
      var params = new URLSearchParams(search || window.location.search);
      var raw = params.get("filters");
      if (!raw) {
        return [];
      }
      try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_e) {
        return [];
      }
    },
    bindBuilder: function (ctx, reload) {
      if (window.__v3FieldRulesBuilderBound) {
        return;
      }
      window.__v3FieldRulesBuilderBound = true;
      document.getElementById("v3-rule-add")?.addEventListener("click", function () {
        var field = document.getElementById("v3-rule-field")?.value;
        var op = document.getElementById("v3-rule-op")?.value;
        var valueEl = document.getElementById("v3-rule-value");
        var value = valueEl && !valueEl.disabled ? String(valueEl.value || "").trim() : "";
        if (["empty", "filled", "yes", "no"].indexOf(op) === -1 && !value) {
          valueEl?.focus();
          return;
        }
        var state = window.ClientsV3.mergeListStateForUserAction({ page: 1 });
        var rules = parseRulesFromState(state);
        rules.push({ field: field, op: op, value: value });
        state.v3Rules = rules.slice(0, 12);
        syncLegacyFromRules(state);
        reload(state);
      });
    },
  };
})();
