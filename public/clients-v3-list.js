(function () {
  "use strict";

  var DEFAULT_LEGAL_COLS = ["name", "city", "manager_name", "rop_name", "status_label"];
  var DEFAULT_RETAIL_COLS = ["name", "city", "manager_name", "rop_name", "closed"];

  var COLUMN_CATALOG = {
    name: { label: "Название", required: true, filterKey: "q" },
    city: { label: "Город", filterKey: "colCity" },
    address_line: { label: "Адрес", filterKey: null },
    manager_name: { label: "Менеджер", filterKey: "colManager" },
    regional_name: { label: "Региональный", filterKey: "colRegional" },
    hardware_name: { label: "Фурнитура", filterKey: null },
    rop_name: { label: "РОП", filterKey: "colRop" },
    status_label: { label: "Статус", filterKey: "colStatus" },
    closed: { label: "Статус", filterKey: "colStatus" },
    type_name: { label: "Тип", filterKey: null },
    category_name: { label: "Категория", filterKey: null },
    holding: { label: "Холдинг", filterKey: null },
    store_address: { label: "Адрес", filterKey: null },
  };

  function isRetailEntity(v3entity) {
    return v3entity === "retail" || v3entity === "orphan_retail";
  }

  function catalogForEntity(v3entity) {
    var retail = isRetailEntity(v3entity);
    var ids = retail
      ? ["name", "city", "manager_name", "regional_name", "rop_name", "closed", "store_address"]
      : [
          "name",
          "city",
          "address_line",
          "manager_name",
          "regional_name",
          "hardware_name",
          "rop_name",
          "status_label",
          "type_name",
          "category_name",
          "holding",
        ];
    return ids
      .map(function (id) {
        var meta = COLUMN_CATALOG[id];
        if (!meta) {
          return null;
        }
        return { id: id, label: meta.label, required: !!meta.required, filterKey: meta.filterKey };
      })
      .filter(Boolean);
  }

  function defaultColumnIds(v3entity) {
    return isRetailEntity(v3entity) ? DEFAULT_RETAIL_COLS.slice() : DEFAULT_LEGAL_COLS.slice();
  }

  function columnsStorageKey(userId, v3entity) {
    return "clients-v3-cols:" + (userId || "anon") + ":" + (v3entity || "legal");
  }

  function parseColumnIds(raw, v3entity) {
    var allowed = new Set(
      catalogForEntity(v3entity).map(function (col) {
        return col.id;
      }),
    );
    var ids = String(raw || "")
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (id) {
        return id && allowed.has(id);
      });
    if (!ids.includes("name")) {
      ids.unshift("name");
    }
    if (!ids.length) {
      return defaultColumnIds(v3entity);
    }
    return ids;
  }

  function resolveVisibleColumns(state, userId) {
    var fromUrl = state.v3cols ? parseColumnIds(state.v3cols, state.v3entity) : null;
    if (fromUrl) {
      return fromUrl;
    }
    try {
      var stored = localStorage.getItem(columnsStorageKey(userId, state.v3entity));
      if (stored) {
        return parseColumnIds(stored, state.v3entity);
      }
    } catch (_err) {
      /* ignore */
    }
    return defaultColumnIds(state.v3entity);
  }

  function persistColumns(userId, v3entity, ids) {
    try {
      localStorage.setItem(columnsStorageKey(userId, v3entity), ids.join(","));
    } catch (_err) {
      /* ignore */
    }
  }

  function cellDisplay(item, colId, shell) {
    if (colId === "holding") {
      if (item.holding_name) {
        return shell.escapeHtml(String(item.holding_name));
      }
      return item.holding_guid ? shell.escapeHtml(String(item.holding_guid).slice(0, 8) + "…") : "—";
    }
    if (colId === "closed") {
      if (item.closed === true) return "Закрыта";
      if (item.closed === false) return "Открыта";
      return "—";
    }
    if (colId === "status_label" || colId === "city") {
      var structured = item[colId] ? String(item[colId]) : "";
      return structured
        ? shell.escapeHtml(structured)
        : '<span class="clients-no-data">Нет данных</span>';
    }
    var value = item[colId];
    if (!value) {
      return '<span class="clients-no-data">Нет данных</span>';
    }
    return shell.escapeHtml(String(value));
  }

  function filterValueFromState(state, filterKey) {
    if (!filterKey) {
      return "";
    }
    return state[filterKey] || "";
  }

  function renderTableHead(shell, tableHeadRow, visibleCols, state, onFilterInput) {
    if (!tableHeadRow) {
      return;
    }
    var labelRow = visibleCols
      .map(function (col) {
        return "<th scope=\"col\">" + shell.escapeHtml(col.label) + "</th>";
      })
      .join("");
    var filterRow = visibleCols
      .map(function (col) {
        if (!col.filterKey) {
          return "<th></th>";
        }
        var val = filterValueFromState(state, col.filterKey);
        var placeholder = col.filterKey === "q" ? "Название…" : "Фильтр…";
        return (
          '<th class="clients-v3-col-filter">' +
          '<input type="search" class="clients-field__input clients-v3-col-filter__input" data-v3-col-filter="' +
          shell.escapeHtml(col.filterKey) +
          '" value="' +
          shell.escapeHtml(val) +
          '" placeholder="' +
          shell.escapeHtml(placeholder) +
          '" aria-label="Фильтр: ' +
          shell.escapeHtml(col.label) +
          '">' +
          "</th>"
        );
      })
      .join("");
    tableHeadRow.innerHTML = labelRow;
    var filterRowEl = tableHeadRow.parentElement?.querySelector("#clients-v3-column-filter-row");
    if (!filterRowEl) {
      filterRowEl = document.createElement("tr");
      filterRowEl.id = "clients-v3-column-filter-row";
      filterRowEl.className = "clients-v3-column-filter-row";
      tableHeadRow.parentElement?.appendChild(filterRowEl);
    }
    filterRowEl.innerHTML = filterRow;
    filterRowEl.querySelectorAll("[data-v3-col-filter]").forEach(function (input) {
      input.addEventListener("change", function () {
        onFilterInput(input.getAttribute("data-v3-col-filter") || "", input.value.trim());
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          onFilterInput(input.getAttribute("data-v3-col-filter") || "", input.value.trim());
        }
      });
    });
  }

  function renderColumnPicker(shell, pickerEl, v3entity, visibleIds, userId, onChange) {
    if (!pickerEl) {
      return;
    }
    var catalog = catalogForEntity(v3entity);
    pickerEl.innerHTML =
      '<div class="clients-columns-picker__grid">' +
      catalog
        .map(function (col) {
          var checked = visibleIds.indexOf(col.id) !== -1;
          var disabled = col.required;
          return (
            '<label class="clients-columns-picker__item' +
            (disabled ? " clients-columns-picker__item--disabled" : "") +
            '">' +
            '<input type="checkbox" data-v3-column-id="' +
            shell.escapeHtml(col.id) +
            '"' +
            (checked ? " checked" : "") +
            (disabled ? " disabled" : "") +
            "> " +
            shell.escapeHtml(col.label) +
            "</label>"
          );
        })
        .join("") +
      "</div>";
    pickerEl.querySelectorAll("input[data-v3-column-id]").forEach(function (input) {
      input.addEventListener("change", function () {
        var next = catalog
          .filter(function (col) {
            if (col.required) {
              return true;
            }
            var box = pickerEl.querySelector('input[data-v3-column-id="' + col.id + '"]');
            return box && box.checked;
          })
          .map(function (col) {
            return col.id;
          });
        persistColumns(userId, v3entity, next);
        onChange(next);
      });
    });
  }

  function syncFilterbar(shell, state, options) {
    var bar = document.getElementById("v3-list-filterbar");
    var citySelect = document.getElementById("v3-city-filter");
    if (!bar || !citySelect) {
      return;
    }
    var cities = (options && options.cities) || [];
    var html = '<option value="">Все города</option>';
    cities.forEach(function (entry) {
      html +=
        '<option value="' +
        shell.escapeHtml(entry.value) +
        '"' +
        (state.city === entry.value ? " selected" : "") +
        ">" +
        shell.escapeHtml(entry.value) +
        " (" +
        entry.count +
        ")</option>";
    });
    citySelect.innerHTML = html;
    var isLegal = state.v3entity === "legal" || state.v3entity === "holdings";
    citySelect.disabled = isLegal && cities.length === 0;
    var hint = bar.querySelector(".clients-v3-list-filterbar__hint");
    if (hint) {
      hint.textContent =
        isLegal && cities.length === 0
          ? "Город для клиентов — только из структурированных полей 1С; фильтр недоступен, пока данных нет."
          : "Сброс сохраняет выбранную команду и сотрудника";
    }
    bar.classList.remove("clients-hidden");
  }

  function applyDensity(dense) {
    var app = document.getElementById("clients-app");
    if (app) {
      app.classList.toggle("clients-v3-dense", !!dense);
    }
    var btn = document.getElementById("v3-density-btn");
    if (btn) {
      btn.textContent = dense ? "Плотно" : "Обычно";
    }
  }

  function mobileMetaLine(item, visibleCols, shell) {
    var parts = [];
    visibleCols.slice(1, 4).forEach(function (col) {
      var html = cellDisplay(item, col.id, shell);
      if (html === "—" || html.indexOf("clients-no-data") !== -1) {
        return;
      }
      parts.push(col.label + ": " + html.replace(/<[^>]+>/g, ""));
    });
    return parts.join(" · ");
  }

  window.ClientsV3List = {
    catalogForEntity: catalogForEntity,
    resolveVisibleColumns: resolveVisibleColumns,
    renderTableHead: renderTableHead,
    renderColumnPicker: renderColumnPicker,
    syncFilterbar: syncFilterbar,
    applyDensity: applyDensity,
    cellDisplay: cellDisplay,
    mobileMetaLine: mobileMetaLine,
    columnsParamFromIds: function (ids) {
      return ids.join(",");
    },
  };
})();
