(function () {
  "use strict";

  var DEFAULT_LEGAL_COLS = ["name", "category_name", "legal_name", "manager_name", "rop_name"];
  var DEFAULT_RETAIL_COLS = ["client_name", "store_address", "manager_name", "lpr_name", "club_status"];
  var DEFAULT_FOCUS_LEGAL_COLS = [
    "name",
    "address_line",
    "category_name",
    "legal_name",
    "contract_number",
    "payment_type",
    "defer_days",
    "credit_limit",
    "discount_amount",
    "markup_percentage",
    "inn",
  ];
  var DEFAULT_FOCUS_RETAIL_COLS = [
    "client_name",
    "store_address",
    "category_name",
    "manager_name",
    "lpr_name",
    "club_status",
    "city",
    "rop_name",
    "club_bonus",
  ];

  var COLUMN_CATALOG = {
    name: { label: "Название клиента", required: true, filterKey: null },
    client_name: { label: "Название клиента", required: true, filterKey: null },
    category_name: { label: "ТОП (тип 1С)", filterKey: null },
    legal_name: { label: "Юридическое лицо", filterKey: null },
    city: { label: "Город", filterKey: null },
    address_line: { label: "Адрес", filterKey: null },
    manager_name: { label: "Менеджер клиента", filterKey: null },
    regional_name: { label: "Региональный", filterKey: null },
    hardware_name: { label: "Фурнитура", filterKey: null },
    rop_name: { label: "РОП клиента", filterKey: null },
    status_label: { label: "Статус", filterKey: null },
    closed: { label: "Статус ТТ", filterKey: null },
    type_name: { label: "Тип", filterKey: null },
    holding: { label: "Холдинг", filterKey: null },
    store_address: { label: "Адрес магазина", filterKey: null },
    lpr_name: { label: "ФИО ЛПР", filterKey: null },
    club_status: { label: "Club", filterKey: null },
    club_bonus: { label: "Club (бонус)", filterKey: null },
    contract_number: { label: "Номер договора", filterKey: null },
    payment_type: { label: "Вид оплаты", filterKey: null },
    defer_days: { label: "Отсрочка, дней", filterKey: null },
    credit_limit: { label: "Лимит договора", filterKey: null },
    discount_amount: { label: "Значение скидки", filterKey: null },
    markup_percentage: { label: "Значение наценки", filterKey: null },
    inn: { label: "ИНН", filterKey: null },
    sales_income_total: { label: "Продажи, ₽", filterKey: null },
    sales_quantity_total: { label: "Продажи, ед.", filterKey: null },
    sales_legal_count: { label: "Юрлица с продажами", filterKey: null },
    sales_by_legal: { label: "Продажи по юрлицам", filterKey: null },
  };

  function isRetailEntity(v3entity) {
    return v3entity === "retail" || v3entity === "orphan_retail";
  }

  function isLegalLikeEntity(v3entity) {
    return v3entity === "legal" || v3entity === "legal_grouped" || v3entity === "holdings";
  }

  function catalogForEntity(v3entity) {
    var retail = isRetailEntity(v3entity);
    var ids = retail
      ? [
          "client_name",
          "store_address",
          "manager_name",
          "lpr_name",
          "club_status",
          "city",
          "category_name",
          "rop_name",
          "club_bonus",
          "closed",
        ]
      : [
          "name",
          "category_name",
          "legal_name",
          "manager_name",
          "rop_name",
          "city",
          "address_line",
          "regional_name",
          "hardware_name",
          "status_label",
          "type_name",
          "holding",
          "contract_number",
          "payment_type",
          "defer_days",
          "credit_limit",
          "discount_amount",
          "markup_percentage",
          "inn",
          "sales_income_total",
          "sales_quantity_total",
          "sales_legal_count",
          "sales_by_legal",
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

  function columnsStorageKey(userId, v3entity, mode) {
    var keyEntity = v3entity === "legal_grouped" ? "legal_grouped" : v3entity || "legal_grouped";
    var suffix = mode === "focus" ? ":focus" : "";
    return "clients-v3-cols:" + (userId || "anon") + ":" + keyEntity + suffix;
  }

  function primaryColumnId(v3entity) {
    return isRetailEntity(v3entity) ? "client_name" : "name";
  }

  function defaultFocusColumnIds(v3entity) {
    return isRetailEntity(v3entity) ? DEFAULT_FOCUS_RETAIL_COLS.slice() : DEFAULT_FOCUS_LEGAL_COLS.slice();
  }

  function parseColumnIds(raw, v3entity) {
    var retail = isRetailEntity(v3entity);
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
    var primary = retail ? "client_name" : "name";
    if (retail && ids.includes("name") && !ids.includes("client_name")) {
      ids = ids.map(function (id) {
        return id === "name" ? "client_name" : id;
      });
    }
    if (!ids.includes(primary)) {
      ids.unshift(primary);
    }
    if (!ids.length) {
      return defaultColumnIds(v3entity);
    }
    return ids;
  }

  function resolveVisibleColumns(state, userId) {
    if (state.v3cols) {
      return parseColumnIds(state.v3cols, state.v3entity);
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

  function resolveFocusColumns(state, userId) {
    if (state.v3focuscols) {
      return parseColumnIds(state.v3focuscols, state.v3entity);
    }
    try {
      var stored = localStorage.getItem(columnsStorageKey(userId, state.v3entity, "focus"));
      if (stored) {
        return parseColumnIds(stored, state.v3entity);
      }
    } catch (_err) {
      /* ignore */
    }
    return defaultFocusColumnIds(state.v3entity);
  }

  function persistColumns(userId, v3entity, ids, mode) {
    try {
      localStorage.setItem(columnsStorageKey(userId, v3entity, mode), ids.join(","));
    } catch (_err) {
      /* ignore */
    }
  }

  function normalizeColumnOrder(existingIds, catalogIds, primary) {
    var allowed = new Set(catalogIds);
    var next = (existingIds || []).filter(function (id) {
      return allowed.has(id);
    });
    if (!next.includes(primary)) {
      next.unshift(primary);
    }
    return next;
  }

  function mergeColumnOrder(existingIds, catalogIds, primary) {
    var next = normalizeColumnOrder(existingIds, catalogIds, primary);
    catalogIds.forEach(function (id) {
      if (!next.includes(id)) {
        next.push(id);
      }
    });
    return next;
  }

  function legalEntityLinks(item, shell, state) {
    var legals = item.legal_entities;
    if (!legals || !legals.length) {
      return null;
    }
    var returnQuery =
      window.ClientsV3 && window.ClientsV3.buildListReturnQuery
        ? window.ClientsV3.buildListReturnQuery(state || {})
        : "";
    return legals
      .map(function (entry) {
        var href =
          "/clients/" +
          encodeURIComponent(entry.guid) +
          "?v3Entity=legal&return=" +
          encodeURIComponent(returnQuery);
        return (
          '<a class="clients-link clients-link--secondary" href="' +
          href +
          '">' +
          shell.escapeHtml(String(entry.name || entry.guid)) +
          "</a>"
        );
      })
      .join(", ");
  }

  function cellDisplay(item, colId, shell, state, grouped) {
    if (colId === "legal_name") {
      if (grouped) {
        var links = legalEntityLinks(item, shell, state);
        if (links) {
          return links;
        }
      }
      var legal = item.legal_name || item.name;
      return legal
        ? shell.escapeHtml(String(legal))
        : '<span class="clients-no-data">Нет данных</span>';
    }
    if (colId === "client_name") {
      var cn = item.client_name || item.holding_name;
      return cn
        ? shell.escapeHtml(String(cn))
        : '<span class="clients-no-data">Нет данных</span>';
    }
    if (colId === "club_status" || colId === "lpr_name") {
      var cv = item[colId];
      return cv
        ? shell.escapeHtml(String(cv))
        : '<span class="clients-no-data">Нет данных</span>';
    }
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
    if (
      colId === "sales_income_total" ||
      colId === "sales_quantity_total" ||
      colId === "sales_legal_count" ||
      colId === "sales_by_legal"
    ) {
      if (window.ClientSalesSummaryUi && window.ClientSalesSummaryUi.formatListSalesCell) {
        return window.ClientSalesSummaryUi.formatListSalesCell(item._clientSales, colId, shell);
      }
      return '<span class="clients-no-data">—</span>';
    }
    if (colId === "category_name") {
      var topLabel =
        item.top_name != null && String(item.top_name).trim() !== ""
          ? item.top_name
          : item.category_name;
      return topLabel
        ? shell.escapeHtml(String(topLabel))
        : '<span class="clients-no-data">Нет данных</span>';
    }
    if (
      colId === "contract_number" ||
      colId === "payment_type" ||
      colId === "inn" ||
      colId === "defer_days" ||
      colId === "credit_limit" ||
      colId === "discount_amount" ||
      colId === "markup_percentage"
    ) {
      var commercial = item[colId];
      if (commercial === 0 || commercial === "0") {
        return shell.escapeHtml(String(commercial));
      }
      return commercial
        ? shell.escapeHtml(String(commercial))
        : '<span class="clients-no-data">Не передано</span>';
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

  function renderTableHead(shell, tableHeadRow, visibleCols, state, onFilterInput, skipColumnFilters) {
    if (!tableHeadRow) {
      return;
    }
    var labelRow = visibleCols
      .map(function (col) {
        return (
          '<th scope="col" class="x13-col x13-col-' +
          shell.escapeHtml(col.id) +
          '">' +
          shell.escapeHtml(col.label) +
          "</th>"
        );
      })
      .join("");
    var filterRow = skipColumnFilters
      ? visibleCols.map(function () {
          return "<th></th>";
        }).join("")
      : visibleCols
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
    if (skipColumnFilters) {
      filterRowEl.classList.add("clients-hidden");
      return;
    }
    filterRowEl.classList.remove("clients-hidden");
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

  function renderColumnPicker(shell, pickerEl, v3entity, visibleIds, userId, onChange, options) {
    if (!pickerEl) {
      return;
    }
    options = options || {};
    var mode = options.mode === "focus" ? "focus" : "normal";
    var catalog = catalogForEntity(v3entity);
    var primary = primaryColumnId(v3entity);
    var catalogIds = catalog.map(function (c) {
      return c.id;
    });
    var orderedIds = visibleIds.slice();
    if (!orderedIds.includes(primary)) {
      orderedIds.unshift(primary);
    }
    orderedIds = normalizeColumnOrder(orderedIds, catalogIds, primary);
    pickerEl.__v3ColumnOrder = orderedIds.slice();
    var pickerOrder = orderedIds.slice();
    catalogIds.forEach(function (id) {
      if (!pickerOrder.includes(id)) {
        pickerOrder.push(id);
      }
    });
    var allSelected = catalogIds.every(function (id) {
      return orderedIds.includes(id);
    });
    var scrollTop = pickerEl.scrollTop || 0;
    var useReorder = options.reorder !== false;
    var gridClass = useReorder
      ? "x6-column-grid x16-columns"
      : "clients-columns-picker__grid" + (options.twoColumn ? " clients-columns-picker__grid--two-col" : "");
    pickerEl.innerHTML =
      (options.intro
        ? '<p class="clients-columns-picker__intro">' + shell.escapeHtml(options.intro) + "</p>"
        : "") +
      (useReorder
        ? '<div class="x16-column-actions">' +
          '<button type="button" data-v3-columns-all' +
          (allSelected ? " disabled" : "") +
          '>Выбрать все</button>' +
          '<button type="button" data-v3-columns-default title="Восстановить стандартный набор и порядок колонок">По умолчанию</button>' +
          "</div>"
        : "") +
      '<div class="' +
      gridClass +
      '">' +
      (useReorder
        ? pickerOrder
            .map(function (id) {
              var col = catalog.find(function (entry) {
                return entry.id === id;
              });
              if (!col) {
                return "";
              }
              var index = orderedIds.indexOf(col.id);
              var checked = index >= 0;
              var movable = checked && col.id !== primary;
              return (
                '<div class="x16-column" data-column-order="' +
                shell.escapeHtml(col.id) +
                '" draggable="' +
                (movable ? "true" : "false") +
                '"><label><input type="checkbox" data-v3-column-id="' +
                shell.escapeHtml(col.id) +
                '"' +
                (checked ? " checked" : "") +
                (col.id === primary ? " disabled" : "") +
                "> " +
                shell.escapeHtml(col.label) +
                "</label>" +
                (movable
                  ? '<div class="x16-arrows"><button type="button" data-v3-column-up="' +
                    shell.escapeHtml(col.id) +
                    '" aria-label="Вверх: ' +
                    shell.escapeHtml(col.label) +
                    '"' +
                    (index === 1 ? " disabled" : "") +
                    '>↑</button><button type="button" data-v3-column-down="' +
                    shell.escapeHtml(col.id) +
                    '" aria-label="Вниз: ' +
                    shell.escapeHtml(col.label) +
                    '"' +
                    (index === orderedIds.length - 1 ? " disabled" : "") +
                    ">↓</button></div>"
                  : "") +
                "</div>"
              );
            })
            .join("")
        : catalog
            .map(function (col) {
              var checked = orderedIds.indexOf(col.id) !== -1;
              return (
                '<label class="clients-columns-picker__item' +
                (col.required ? " clients-columns-picker__item--disabled" : "") +
                '"><input type="checkbox" data-v3-column-id="' +
                shell.escapeHtml(col.id) +
                '"' +
                (checked ? " checked" : "") +
                (col.required ? " disabled" : "") +
                "> " +
                shell.escapeHtml(col.label) +
                "</label>"
              );
            })
            .join("")) +
      "</div>";

    function commit(nextIds, options) {
      options = options || {};
      var normalized = options.selectAll
        ? mergeColumnOrder(nextIds, catalogIds, primary)
        : normalizeColumnOrder(nextIds, catalogIds, primary);
      persistColumns(userId, v3entity, normalized, mode === "focus" ? "focus" : undefined);
      onChange(normalized);
    }

    function reorderColumn(id, targetIndex) {
      var list = (pickerEl.__v3ColumnOrder || orderedIds).slice();
      var from = list.indexOf(id);
      if (from < 1 || targetIndex < 1 || targetIndex >= list.length) {
        return;
      }
      list.splice(from, 1);
      list.splice(targetIndex, 0, id);
      commit(list);
    }

    pickerEl.querySelectorAll("input[data-v3-column-id]").forEach(function (input) {
      input.addEventListener("change", function () {
        var id = input.getAttribute("data-v3-column-id") || "";
        if (id === primary) {
          return;
        }
        var next = (pickerEl.__v3ColumnOrder || orderedIds).slice();
        if (input.checked) {
          if (!next.includes(id)) {
            next.push(id);
          }
        } else {
          next = next.filter(function (x) {
            return x !== id;
          });
        }
        commit(next);
      });
    });

    if (useReorder) {
      pickerEl.querySelector("[data-v3-columns-all]")?.addEventListener("click", function () {
        commit(
          mergeColumnOrder(
            (pickerEl.__v3ColumnOrder || orderedIds).slice(),
            catalogIds,
            primary,
          ),
          { selectAll: true },
        );
      });
      pickerEl.querySelector("[data-v3-columns-default]")?.addEventListener("click", function () {
        commit(mode === "focus" ? defaultFocusColumnIds(v3entity) : defaultColumnIds(v3entity));
      });
      pickerEl.querySelectorAll("[data-v3-column-up]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-v3-column-up") || "";
          reorderColumn(id, (pickerEl.__v3ColumnOrder || orderedIds).indexOf(id) - 1);
        });
      });
      pickerEl.querySelectorAll("[data-v3-column-down]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-v3-column-down") || "";
          reorderColumn(id, (pickerEl.__v3ColumnOrder || orderedIds).indexOf(id) + 1);
        });
      });
      if (!pickerEl.dataset.dragBound) {
        pickerEl.dataset.dragBound = "1";
        pickerEl.addEventListener("dragstart", function (event) {
          var row = event.target.closest("[data-column-order][draggable=\"true\"]");
          if (row && event.dataTransfer) {
            event.dataTransfer.setData("text/plain", row.getAttribute("data-column-order") || "");
            event.dataTransfer.effectAllowed = "move";
          }
        });
        pickerEl.addEventListener("dragover", function (event) {
          if (event.target.closest("[data-column-order][draggable=\"true\"]")) {
            event.preventDefault();
          }
        });
        pickerEl.addEventListener("drop", function (event) {
          var row = event.target.closest("[data-column-order][draggable=\"true\"]");
          if (!row || !event.dataTransfer) {
            return;
          }
          event.preventDefault();
          var draggedId = event.dataTransfer.getData("text/plain");
          var targetId = row.getAttribute("data-column-order") || "";
          var currentOrder = pickerEl.__v3ColumnOrder || orderedIds;
          reorderColumn(draggedId, currentOrder.indexOf(targetId));
        });
      }
    }

    pickerEl.scrollTop = scrollTop;
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
    var categorySelect = document.getElementById("v3-lktandoor-category-filter");
    if (categorySelect && options && options.categories) {
      var catHtml = '<option value="">Все категории</option>';
      var selectedCats = [];
      if (state.v3categories && state.v3categories.length) {
        selectedCats = state.v3categories.slice();
      } else if (state.v3category) {
        selectedCats = [state.v3category];
      }
      (options.categories || []).forEach(function (entry) {
        catHtml +=
          '<option value="' +
          shell.escapeHtml(entry.guid) +
          '"' +
          (selectedCats.indexOf(entry.guid) !== -1 ? " selected" : "") +
          ">" +
          shell.escapeHtml(entry.name + " (" + entry.count + ")") +
          "</option>";
      });
      categorySelect.innerHTML = catHtml;
    }
    var isLegal = isLegalLikeEntity(state.v3entity);
    citySelect.disabled = isLegal && cities.length === 0;
    var hint = bar.querySelector(".clients-v3-list-filterbar__hint");
    if (hint) {
      var lktandoor = document.getElementById("clients-app")?.classList.contains("clients-lktandoor-list");
      if (lktandoor) {
        hint.textContent = "Только выбранная территория";
      } else {
        hint.textContent =
          isLegal && cities.length === 0
            ? "Город для клиентов — только из структурированных полей 1С; фильтр недоступен, пока данных нет."
            : "Сброс сохраняет выбранную команду и сотрудника";
      }
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
    resolveFocusColumns: resolveFocusColumns,
    defaultFocusColumnIds: defaultFocusColumnIds,
    defaultColumnIds: defaultColumnIds,
    primaryColumnId: primaryColumnId,
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
