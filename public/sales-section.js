(function () {
  "use strict";

  var root = document.getElementById("sales-section-root");
  var subtitle = document.getElementById("sales-page-subtitle");
  var loadGeneration = 0;
  var drillGeneration = 0;
  var cachedMonths = [];
  var lastOverview = null;
  var activeTab = "sales";

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

  function buildOverviewUrl(month) {
    var params = queryParams();
    params.set("month", month);
    return "/api/clients/v3/sales/overview?" + params.toString();
  }

  function buildSkuUrl(month, productType, kind) {
    var params = queryParams();
    params.set("month", month);
    params.set("productType", productType);
    params.set("kind", kind);
    return "/api/clients/v3/sales/sku?" + params.toString();
  }

  function buildClientsUrl(month, productType, guidItem, kind) {
    var params = queryParams();
    params.set("month", month);
    params.set("productType", productType);
    params.set("guidItem", guidItem);
    params.set("kind", kind);
    return "/api/clients/v3/sales/clients?" + params.toString();
  }

  function renderMacroGrid(rows, testId) {
    if (!rows || !rows.length) {
      return '<p class="sales-empty">Нет данных из 1С за выбранный период в вашей области видимости.</p>';
    }
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
      if (row.grossProfit != null) {
        html += "<p>Валовая прибыль: " + formatNum(row.grossProfit) + " ₽</p>";
      }
      if (row.profitabilityPercent != null) {
        html += "<p>Рентабельность: " + formatNum(row.profitabilityPercent) + "%</p>";
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function categoryColumns(policy) {
    var cols = [
      { key: "productType", label: "Категория", always: true },
      { key: "quantity", label: "Кол-во, шт", always: true },
      { key: "income", label: "Выручка, ₽", always: true },
    ];
    if (policy && policy.totalDiscount) {
      cols.push({ key: "totalDiscount", label: "Скидки, ₽" });
    }
    if (policy && policy.grossProfit) {
      cols.push({ key: "grossProfit", label: "Валовая прибыль, ₽" });
    }
    if (policy && policy.profitability) {
      cols.push({ key: "profitabilityPercent", label: "Рентабельность, %" });
    }
    cols.push({ key: "_actions", label: "" });
    return cols;
  }

  function mountCategoryTable(container, rows, testId, month, kind, policy) {
    container.innerHTML = "";
    if (!rows || !rows.length) {
      return;
    }
    var table = document.createElement("table");
    table.className = "sales-category-table";
    table.setAttribute("data-testid", testId);
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    categoryColumns(policy).forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = col.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      categoryColumns(policy).forEach(function (col) {
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
        } else {
          td.textContent = formatNum(row[col.key]);
          if (col.key === "productType") {
            td.textContent = row.productType;
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderToolbarShell(month) {
    return (
      '<div class="sales-section-toolbar">' +
      '<label>Месяц <select id="sales-month-select" data-testid="sales-month-select"></select></label>' +
      '<label>Категория <input id="sales-category-filter" data-testid="sales-category-filter" placeholder="фильтр" /></label>' +
      '<div class="sales-section-tabs" role="tablist">' +
      '<button type="button" class="sales-section-tab" data-tab="sales" aria-selected="' +
      (activeTab === "sales" ? "true" : "false") +
      '">Продажи</button>' +
      '<button type="button" class="sales-section-tab" data-tab="returns" aria-selected="' +
      (activeTab === "returns" ? "true" : "false") +
      '">Возвраты</button>' +
      "</div></div>" +
      '<div id="sales-drill-panel" data-testid="sales-drill-panel"></div>' +
      '<div id="sales-macro-host"></div>' +
      '<div id="sales-category-host"></div>'
    );
  }

  function bindDrillHandlers() {
    root.querySelectorAll("[data-drill-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var productType = btn.getAttribute("data-drill-category") || "";
        var month = btn.getAttribute("data-drill-month") || "";
        var kind = btn.getAttribute("data-drill-kind") || activeTab;
        var gen = ++drillGeneration;
        var panel = document.getElementById("sales-drill-panel");
        if (!panel) {
          return;
        }
        panel.innerHTML = '<p class="sales-note">Загрузка товаров…</p>';
        api
          .apiRequest(buildSkuUrl(month, productType, kind))
          .then(function (result) {
            if (gen !== drillGeneration) {
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
            thead.innerHTML = "<tr><th>Товар</th><th>Кол-во</th><th>Выручка</th><th></th></tr>";
            table.appendChild(thead);
            var tbody = document.createElement("tbody");
            items.forEach(function (row) {
              var tr = document.createElement("tr");
              var nameTd = document.createElement("td");
              nameTd.textContent = row.nameItem;
              tr.appendChild(nameTd);
              var qTd = document.createElement("td");
              qTd.textContent = formatNum(row.quantity);
              tr.appendChild(qTd);
              var iTd = document.createElement("td");
              iTd.textContent = formatNum(row.income);
              tr.appendChild(iTd);
              var actTd = document.createElement("td");
              var clientBtn = document.createElement("button");
              clientBtn.type = "button";
              clientBtn.className = "sales-section-tab";
              clientBtn.textContent = "Клиенты";
              clientBtn.addEventListener("click", function () {
                loadClients(month, productType, row.guidItem, kind, panel);
              });
              actTd.appendChild(clientBtn);
              tr.appendChild(actTd);
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            panel.appendChild(table);
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

  function loadClients(month, productType, guidItem, kind, panel) {
    var gen = ++drillGeneration;
    panel.innerHTML = '<p class="sales-note">Загрузка клиентов…</p>';
    api
      .apiRequest(buildClientsUrl(month, productType, guidItem, kind))
      .then(function (result) {
        if (gen !== drillGeneration) {
          return;
        }
        if (result.response.status !== 200) {
          panel.innerHTML = '<p class="sales-empty">Не удалось загрузить клиентов.</p>';
          return;
        }
        var clients = result.data.clients || [];
        if (!clients.length) {
          panel.innerHTML = '<p class="sales-empty">Нет клиентов в области видимости.</p>';
          return;
        }
        var table = document.createElement("table");
        table.className = "sales-category-table";
        table.setAttribute("data-testid", "sales-clients-table");
        var thead = document.createElement("thead");
        thead.innerHTML = "<tr><th>Юрлицо</th><th>Кол-во</th><th>Выручка</th></tr>";
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        clients.forEach(function (row) {
          var tr = document.createElement("tr");
          var nameTd = document.createElement("td");
          var link = document.createElement("a");
          link.href = "/clients/" + encodeURIComponent(row.legalGuid);
          link.textContent = row.legalName;
          nameTd.appendChild(link);
          tr.appendChild(nameTd);
          var qTd = document.createElement("td");
          qTd.textContent = formatNum(row.quantity);
          tr.appendChild(qTd);
          var iTd = document.createElement("td");
          iTd.textContent = formatNum(row.income);
          tr.appendChild(iTd);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        panel.innerHTML = "";
        panel.appendChild(table);
      })
      .catch(function () {
        if (gen !== drillGeneration) {
          return;
        }
        panel.innerHTML = '<p class="sales-empty">Ошибка сети при загрузке клиентов.</p>';
      });
  }

  function paintOverview(ov, month) {
    var policy = ov.fieldPolicy || {};
    var tab = activeTab === "returns" ? "returns" : "sales";
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
      macroHost.innerHTML = renderMacroGrid(macro, tab === "returns" ? "sales-returns-macro" : "sales-macro");
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
      );
      bindDrillHandlers();
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

  function loadOverview(month) {
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
          renderToolbarShell(month) +
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
        root.querySelectorAll(".sales-section-tab[data-tab]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            activeTab = btn.getAttribute("data-tab") || "sales";
            paintOverview(lastOverview, month);
          });
        });
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
          if (subtitle) {
            subtitle.textContent = month ? "Период " + month : "";
          }
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
