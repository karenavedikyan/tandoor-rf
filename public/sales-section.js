(function () {
  "use strict";

  var api = window.TandoorRf;
  var root = document.getElementById("sales-section-root");
  var subtitle = document.getElementById("sales-page-subtitle");
  var loadGeneration = 0;
  var drillGeneration = 0;
  var cachedMonths = [];
  var lastOverview = null;
  var activeTab = "sales";
  var currentMonth = "";
  var lastFieldPolicy = {};
  var shellUser = null;

  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  function formatNum(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return "—";
    }
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function setMonthInUrl(month) {
    var params = queryParams();
    params.set("month", month);
    window.history.replaceState({}, "", "/sales?" + params.toString());
  }

  function setUrlParams(patch) {
    var params = queryParams();
    Object.keys(patch).forEach(function (key) {
      var val = patch[key];
      if (val == null || val === "") {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    });
    window.history.replaceState({}, "", "/sales?" + params.toString());
  }

  function syncSubtitle(month) {
    currentMonth = month || currentMonth;
    if (subtitle) {
      subtitle.textContent = currentMonth ? "Период " + currentMonth : "";
    }
  }

  function buildOverviewUrl(month) {
    var params = queryParams();
    params.set("month", month);
    return "/api/clients/v3/sales/overview?" + params.toString();
  }

  function buildSkuUrl(month, productType, kind, skuQuery) {
    var params = queryParams();
    params.set("month", month);
    params.set("productType", productType);
    params.set("kind", kind);
    if (skuQuery) {
      params.set("skuQuery", skuQuery);
    }
    return "/api/clients/v3/sales/sku?" + params.toString();
  }

  function buildClientsUrl(month, productType, guidItem, kind, clientQuery) {
    var params = queryParams();
    params.set("month", month);
    params.set("productType", productType);
    params.set("guidItem", guidItem);
    params.set("kind", kind);
    if (clientQuery) {
      params.set("clientQuery", clientQuery);
    }
    return "/api/clients/v3/sales/clients?" + params.toString();
  }

  function salesReturnParam() {
    var params = queryParams();
    params.set("kind", activeTab === "returns" ? "returns" : "sales");
    if (currentMonth) {
      params.set("month", currentMonth);
    }
    return encodeURIComponent("/sales?" + params.toString());
  }

  function legalDetailHref(legalGuid) {
    return (
      "/clients/" +
      encodeURIComponent(legalGuid) +
      "?v3Entity=legal&return=" +
      salesReturnParam()
    );
  }

  function invalidateDrill() {
    drillGeneration += 1;
    var panel = document.getElementById("sales-drill-panel");
    if (panel) {
      panel.innerHTML = "";
    }
  }

  function syncTabAria() {
    if (!root) {
      return;
    }
    root.querySelectorAll(".sales-section-tab[data-tab]").forEach(function (btn) {
      var tab = btn.getAttribute("data-tab");
      btn.setAttribute("aria-selected", tab === activeTab ? "true" : "false");
    });
  }

  function metricColumnDefs(policy, financeAvailability) {
    var avail = financeAvailability || {};
    var cols = [
      { key: "quantity", label: "Кол-во, шт" },
      { key: "income", label: "Выручка, ₽" },
    ];
    if (policy.manualDiscount && avail.manualDiscount) {
      cols.push({ key: "manualDiscount", label: "Ручная скидка, ₽" });
    }
    if (policy.automaticDiscount && avail.automaticDiscount) {
      cols.push({ key: "automaticDiscount", label: "Автоскидка, ₽" });
    }
    if (policy.totalDiscount && avail.totalDiscount) {
      cols.push({ key: "totalDiscount", label: "Скидки, ₽" });
    }
    if (policy.additionalExpenses && avail.additionalExpenses) {
      cols.push({ key: "additionalExpenses", label: "Доп. расходы, ₽" });
    }
    if (policy.costPrice && avail.costPrice) {
      cols.push({ key: "costPrice", label: "Себестоимость, ₽" });
    }
    if (policy.grossProfit && avail.grossProfit) {
      cols.push({ key: "grossProfit", label: "Валовая прибыль, ₽" });
    }
    if (policy.profitability && avail.profitability) {
      cols.push({ key: "profitabilityPercent", label: "Рентабельность, %" });
    }
    return cols;
  }

  function categoryColumns(policy, financeAvailability) {
    var cols = [{ key: "productType", label: "Категория", text: true }].concat(
      metricColumnDefs(policy, financeAvailability),
    );
    cols.push({ key: "_actions", label: "" });
    return cols;
  }

  function appendMetricCells(tr, row, policy, financeAvailability) {
    metricColumnDefs(policy, financeAvailability).forEach(function (col) {
      var td = document.createElement("td");
      var val = row[col.key];
      td.textContent = val == null ? "—" : formatNum(val);
      tr.appendChild(td);
    });
  }

  function wrapScrollTable(table) {
    var wrap = document.createElement("div");
    wrap.className = "sales-table-scroll";
    wrap.appendChild(table);
    return wrap;
  }

  function renderMacroGrid(rows, testId, financeAvailability) {
    if (!rows || !rows.length) {
      return '<p class="sales-empty">Нет данных из 1С за выбранный период в вашей области видимости.</p>';
    }
    var avail = financeAvailability || {};
    var html = '<div class="sales-macro-grid" data-testid="' + esc(testId) + '">';
    rows.forEach(function (row) {
      html +=
        '<div class="sales-macro-card"><h3>' +
        esc(row.label) +
        "</h3><p>Выручка: " +
        formatNum(row.income) +
        " ₽</p><p>Кол-во: " +
        formatNum(row.quantity) +
        " шт</p>";
      if (avail.grossProfit && row.grossProfit != null) {
        html += "<p>Валовая прибыль: " + formatNum(row.grossProfit) + " ₽</p>";
      }
      if (avail.profitability && row.profitabilityPercent != null) {
        html += "<p>Рентабельность: " + formatNum(row.profitabilityPercent) + "%</p>";
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function mountCategoryTable(container, rows, testId, month, kind, policy, financeAvailability) {
    container.innerHTML = "";
    if (!rows || !rows.length) {
      return;
    }
    var table = document.createElement("table");
    table.className = "sales-category-table";
    table.setAttribute("data-testid", testId);
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    categoryColumns(policy, financeAvailability).forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = col.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      categoryColumns(policy, financeAvailability).forEach(function (col) {
        var td = document.createElement("td");
        if (col.key === "_actions") {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "sales-section-tab";
          btn.textContent = "Товары";
          btn.setAttribute("data-drill-category", row.productType);
          btn.setAttribute("data-drill-month", month);
          btn.setAttribute("data-drill-kind", kind);
          td.appendChild(btn);
        } else if (col.key === "productType") {
          td.textContent = row.productType;
        } else {
          td.textContent = formatNum(row[col.key]);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(wrapScrollTable(table));
  }

  function renderToolbarShell() {
    return (
      '<div class="sales-section-toolbar">' +
      '<label>Месяц <select id="sales-month-select" data-testid="sales-month-select"></select></label>' +
      '<label class="sales-filter-label">Поиск в списке категорий <input id="sales-category-filter" data-testid="sales-category-filter" placeholder="фильтр" /></label>' +
      '<label class="sales-filter-label">Товар <input id="sales-sku-filter" data-testid="sales-sku-filter" placeholder="поиск SKU" /></label>' +
      '<label class="sales-filter-label">Клиент <input id="sales-client-filter" data-testid="sales-client-filter" placeholder="поиск юрлица" /></label>' +
      '<label id="sales-territory-label" class="sales-filter-label sales-hidden">Менеджер <select id="sales-territory-select" data-testid="sales-territory-select"><option value="">Вся доступная область</option></select></label>' +
      '<p class="sales-note sales-filter-hint">Сводка по макрогруппам — по всей выбранной территории; поиск в списке категорий не меняет сводку.</p>' +
      '<div class="sales-section-tabs" role="tablist">' +
      '<button type="button" class="sales-section-tab" data-tab="sales" role="tab" aria-selected="' +
      (activeTab === "sales" ? "true" : "false") +
      '">Продажи</button>' +
      '<button type="button" class="sales-section-tab" data-tab="returns" role="tab" aria-selected="' +
      (activeTab === "returns" ? "true" : "false") +
      '">Возвраты</button>' +
      "</div></div>" +
      '<div id="sales-drill-panel" data-testid="sales-drill-panel"></div>' +
      '<div id="sales-macro-host"></div>' +
      '<div id="sales-category-host"></div>'
    );
  }

  function bindDrillHandlers(policy, financeAvailability) {
    root.querySelectorAll("[data-drill-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var productType = btn.getAttribute("data-drill-category") || "";
        var month = btn.getAttribute("data-drill-month") || currentMonth;
        var kind = btn.getAttribute("data-drill-kind") || activeTab;
        var gen = ++drillGeneration;
        var panel = document.getElementById("sales-drill-panel");
        if (!panel) {
          return;
        }
        panel.innerHTML = '<p class="sales-note">Загрузка товаров…</p>';
        var skuQuery = (document.getElementById("sales-sku-filter")?.value || "").trim();
        api
          .apiRequest(buildSkuUrl(month, productType, kind, skuQuery))
          .then(function (result) {
            if (gen !== drillGeneration) {
              return;
            }
            if (kind !== activeTab) {
              return;
            }
            if (result.response.status !== 200) {
              panel.innerHTML =
                '<p class="sales-empty">Детализация недоступна. <button type="button" class="sales-retry-drill">Повторить</button></p>';
              panel.querySelector(".sales-retry-drill")?.addEventListener("click", function () {
                btn.click();
              });
              return;
            }
            var drillPolicy = result.data.fieldPolicy || policy || lastFieldPolicy;
            var drillFinance = result.data.financeAvailability || financeAvailability;
            var items = result.data.items || [];
            if (!items.length) {
              panel.innerHTML = '<p class="sales-empty">Нет товаров в области видимости.</p>';
              return;
            }
            panel.innerHTML = "";
            var table = document.createElement("table");
            table.className = "sales-category-table";
            table.setAttribute("data-testid", "sales-sku-table");
            var thead = document.createElement("thead");
            var headRow = document.createElement("tr");
            var headCols = [{ key: "nameItem", label: "Товар", text: true }].concat(
              metricColumnDefs(drillPolicy, drillFinance),
            );
            headCols.push({ key: "_actions", label: "" });
            headCols.forEach(function (col) {
              var th = document.createElement("th");
              th.textContent = col.label;
              headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);
            var tbody = document.createElement("tbody");
            items.forEach(function (row) {
              var tr = document.createElement("tr");
              var nameTd = document.createElement("td");
              nameTd.textContent = row.nameItem;
              tr.appendChild(nameTd);
              appendMetricCells(tr, row, drillPolicy, drillFinance);
              var actTd = document.createElement("td");
              var clientBtn = document.createElement("button");
              clientBtn.type = "button";
              clientBtn.className = "sales-section-tab";
              clientBtn.textContent = "Клиенты";
              clientBtn.addEventListener("click", function () {
                loadClients(month, productType, row.guidItem, kind, panel, drillPolicy, drillFinance);
              });
              actTd.appendChild(clientBtn);
              tr.appendChild(actTd);
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            panel.appendChild(wrapScrollTable(table));
          })
          .catch(function () {
            if (gen !== drillGeneration) {
              return;
            }
            panel.innerHTML =
              '<p class="sales-empty">Ошибка сети. <button type="button" class="sales-retry-drill">Повторить</button></p>';
            panel.querySelector(".sales-retry-drill")?.addEventListener("click", function () {
              btn.click();
            });
          });
      });
    });
  }

  function loadClients(month, productType, guidItem, kind, panel, policy, financeAvailability) {
    var gen = ++drillGeneration;
    panel.innerHTML = '<p class="sales-note">Загрузка клиентов…</p>';
    var clientQuery = (document.getElementById("sales-client-filter")?.value || "").trim();
    api
      .apiRequest(buildClientsUrl(month, productType, guidItem, kind, clientQuery))
      .then(function (result) {
        if (gen !== drillGeneration) {
          return;
        }
        if (kind !== activeTab) {
          return;
        }
        if (result.response.status !== 200) {
          panel.innerHTML = '<p class="sales-empty">Не удалось загрузить клиентов.</p>';
          return;
        }
        var clientPolicy = result.data.fieldPolicy || policy || lastFieldPolicy;
        var clientFinance = result.data.financeAvailability || financeAvailability;
        var clients = result.data.clients || [];
        if (!clients.length) {
          panel.innerHTML = '<p class="sales-empty">Нет клиентов в области видимости.</p>';
          return;
        }
        var table = document.createElement("table");
        table.className = "sales-category-table";
        table.setAttribute("data-testid", "sales-clients-table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        var headCols = [{ key: "legalName", label: "Юрлицо", text: true }].concat(
          metricColumnDefs(clientPolicy, clientFinance),
        );
        headCols.forEach(function (col) {
          var th = document.createElement("th");
          th.textContent = col.label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        clients.forEach(function (row) {
          var tr = document.createElement("tr");
          var nameTd = document.createElement("td");
          var link = document.createElement("a");
          link.href = legalDetailHref(row.legalGuid);
          link.textContent = row.legalName;
          nameTd.appendChild(link);
          tr.appendChild(nameTd);
          appendMetricCells(tr, row, clientPolicy, clientFinance);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        panel.innerHTML = "";
        panel.appendChild(wrapScrollTable(table));
      })
      .catch(function () {
        if (gen !== drillGeneration) {
          return;
        }
        panel.innerHTML = '<p class="sales-empty">Ошибка сети при загрузке клиентов.</p>';
      });
  }

  function paintOverview(ov, month) {
    invalidateDrill();
    syncTabAria();
    var policy = ov.fieldPolicy || {};
    lastFieldPolicy = policy;
    var tab = activeTab === "returns" ? "returns" : "sales";
    var financeAvailability =
      tab === "returns"
        ? ov.returnsFinanceAvailability || { grossProfit: false, profitability: false }
        : {
            manualDiscount: true,
            automaticDiscount: true,
            totalDiscount: true,
            costPrice: true,
            additionalExpenses: true,
            grossProfit: true,
            profitability: true,
          };
    var macro = tab === "returns" ? ov.returnsMacroSummaries || [] : ov.macroSummaries || [];
    var categories = tab === "returns" ? ov.returnsCategories || [] : ov.categories || [];
    var filter = (document.getElementById("sales-category-filter")?.value || "").trim().toLowerCase();
    if (filter) {
      categories = categories.filter(function (row) {
        return String(row.productType || "").toLowerCase().includes(filter);
      });
    }
    var macroHost = document.getElementById("sales-macro-host");
    if (macroHost) {
      macroHost.innerHTML = renderMacroGrid(
        macro,
        tab === "returns" ? "sales-returns-macro" : "sales-macro",
        financeAvailability,
      );
    }
    var catHost = document.getElementById("sales-category-host");
    if (catHost) {
      mountCategoryTable(
        catHost,
        categories,
        tab === "returns" ? "sales-returns-categories" : "sales-categories",
        month,
        tab,
        policy,
        financeAvailability,
      );
      bindDrillHandlers(policy, financeAvailability);
    }
    var note = document.getElementById("sales-source-note");
    if (note) {
      note.textContent =
        tab === "returns"
          ? ov.returnsSignedNote || ""
          : (ov.vatNote || "") + " Источник: " + (ov.salesSource || "none") + ".";
      if (ov.importMeta && ov.importMeta.coverageNote) {
        note.textContent += " " + ov.importMeta.coverageNote;
      }
    }
  }

  function loadTerritoryOptions(user) {
    var label = document.getElementById("sales-territory-label");
    var select = document.getElementById("sales-territory-select");
    if (!label || !select || !user) {
      return;
    }
    var canPick =
      user.role === "admin" || user.role === "director" || user.role === "rop" || user.fullClientBase;
    if (!canPick) {
      label.classList.add("sales-hidden");
      return;
    }
    label.classList.remove("sales-hidden");
    var params = queryParams();
    api
      .apiRequest("/api/clients/v3/options?entity=legal&" + params.toString())
      .then(function (result) {
        if (result.response.status !== 200) {
          return;
        }
        var managers = result.data.managers || [];
        select.innerHTML = '<option value="">Вся доступная область</option>';
        managers.forEach(function (row) {
          var opt = document.createElement("option");
          opt.value = row.guid;
          opt.textContent = row.name + " (" + row.count + ")";
          select.appendChild(opt);
        });
        var current = params.get("responsibleGuid") || params.get("managerGuid") || "";
        if (current) {
          select.value = current;
        }
      })
      .catch(function () {
        /* ignore */
      });
    select.onchange = function () {
      var guid = select.value;
      if (guid) {
        setUrlParams({ responsibleGuid: guid, responsibleKind: "manager", managerGuid: guid });
      } else {
        setUrlParams({ responsibleGuid: "", responsibleKind: "", managerGuid: "" });
      }
      loadOverview(currentMonth);
    };
  }

  function loadOverview(month) {
    syncSubtitle(month);
    var params = queryParams();
    var kindParam = params.get("kind");
    if (kindParam === "returns" || kindParam === "sales") {
      activeTab = kindParam;
    }
    var gen = ++loadGeneration;
    drillGeneration += 1;
    root.innerHTML = '<p class="sales-note">Загрузка…</p>';
    return api
      .apiRequest(buildOverviewUrl(month))
      .then(function (result) {
        if (gen !== loadGeneration) {
          return;
        }
        if (result.response.status !== 200) {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-error">Не удалось загрузить данные. <button type="button" id="sales-retry">Повторить</button></div>';
          document.getElementById("sales-retry")?.addEventListener("click", function () {
            loadOverview(month);
          });
          return;
        }
        lastOverview = result.data.overview || {};
        var ov = lastOverview;
        if (ov.dataState === "schema_not_ready") {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-schema-not-ready">Схема продаж ещё не применена (миграции 047–048).</div>';
          return;
        }
        if (ov.dataState === "not_imported") {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-not-imported">Нет загруженных данных из 1С.</div>';
          return;
        }
        root.innerHTML =
          renderToolbarShell() +
          '<p class="sales-note" data-testid="sales-source-note"></p>' +
          '<p class="sales-note">' +
          esc(ov.periodComparisonNote || "") +
          "</p>";
        fillMonthSelect(cachedMonths.length ? cachedMonths : [month], month);
        paintOverview(ov, month);
        document.getElementById("sales-month-select")?.addEventListener("change", function (e) {
          setMonthInUrl(e.target.value);
          loadOverview(e.target.value);
        });
        document.getElementById("sales-category-filter")?.addEventListener("input", function () {
          paintOverview(lastOverview, month);
        });
        document.getElementById("sales-sku-filter")?.addEventListener("input", function () {
          invalidateDrill();
        });
        document.getElementById("sales-client-filter")?.addEventListener("input", function () {
          invalidateDrill();
        });
        root.querySelectorAll(".sales-section-tab[data-tab]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            activeTab = btn.getAttribute("data-tab") || "sales";
            setUrlParams({ kind: activeTab });
            paintOverview(lastOverview, month);
          });
        });
        if (shellUser) {
          loadTerritoryOptions(shellUser);
        }
      })
      .catch(function () {
        if (gen !== loadGeneration) {
          return;
        }
        root.innerHTML =
          '<div class="sales-empty" data-testid="sales-error">Ошибка сети. <button type="button" id="sales-retry">Повторить</button></div>';
        document.getElementById("sales-retry")?.addEventListener("click", function () {
          loadOverview(month);
        });
      });
  }

  function fillMonthSelect(months, selected) {
    var select = document.getElementById("sales-month-select");
    if (!select) {
      return;
    }
    select.innerHTML = "";
    (months || []).forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === selected) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function boot() {
    if (!window.ClientsShell || !api) {
      return;
    }
    ClientsShell.mountAuthenticatedShell("sales", function (user, reason) {
      if (reason || !user) {
        window.location.href = "/login";
        return;
      }
      shellUser = user;
      api
        .apiRequest("/api/clients/v3/sales/months" + (window.location.search || ""))
        .then(function (monthsResult) {
          if (monthsResult.response.status === 503 && monthsResult.data?.dataState === "schema_not_ready") {
            root.innerHTML =
              '<div class="sales-empty" data-testid="sales-schema-not-ready">Схема продаж ещё не применена.</div>';
            return;
          }
          if (monthsResult.response.status !== 200) {
            root.innerHTML =
              '<div class="sales-empty" data-testid="sales-error">Не удалось загрузить периоды. <button type="button" id="sales-retry">Повторить</button></div>';
            document.getElementById("sales-retry")?.addEventListener("click", boot);
            return;
          }
          cachedMonths = monthsResult.data.months || [];
          var params = queryParams();
          var month = params.get("month") || cachedMonths[0] || "";
          syncSubtitle(month);
          if (!month) {
            root.innerHTML =
              '<div class="sales-empty" data-testid="sales-not-imported">Нет загруженных данных из 1С.</div>';
            return;
          }
          loadOverview(month);
        })
        .catch(function () {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-error">Ошибка сети при загрузке периодов.</div>';
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
