(function () {
  "use strict";

  var root = document.getElementById("sales-section-root");
  var subtitle = document.getElementById("sales-page-subtitle");
  var loadGeneration = 0;
  var cachedMonths = [];

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
    var next = "/sales?" + params.toString();
    window.history.replaceState({}, "", next);
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
        " шт</p></div>";
    });
    html += "</div>";
    return html;
  }

  function renderCategoryTable(rows, testId, month, kind) {
    if (!rows || !rows.length) {
      return "";
    }
    var html =
      '<table class="sales-category-table" data-testid="' +
      esc(testId) +
      '"><thead><tr><th>Категория</th><th>Кол-во, шт</th><th>Выручка, ₽</th><th></th></tr></thead><tbody>';
    rows.forEach(function (row) {
      html +=
        "<tr><td>" +
        esc(row.productType) +
        "</td><td>" +
        formatNum(row.quantity) +
        "</td><td>" +
        formatNum(row.income) +
        '</td><td><button type="button" class="sales-section-tab" data-drill-category="' +
        esc(row.productType) +
        '" data-drill-month="' +
        esc(month) +
        '" data-drill-kind="' +
        esc(kind) +
        '">Товары</button></td></tr>';
    });
    html += "</tbody></table>";
    return html;
  }

  function renderOverview(data, activeTab, month) {
    var ov = data.overview || {};
    if (ov.dataState === "schema_not_ready") {
      return (
        '<div class="sales-empty" data-testid="sales-schema-not-ready">Схема продаж ещё не применена (миграция 047). Данные из 1С недоступны.</div>'
      );
    }
    if (ov.dataState === "not_imported") {
      return (
        '<div class="sales-empty" data-testid="sales-not-imported">Нет загруженных данных из 1С.</div>'
      );
    }
    var tab = activeTab === "returns" ? "returns" : "sales";
    var macro = tab === "returns" ? ov.returnsMacroSummaries || [] : ov.macroSummaries || [];
    var categories = tab === "returns" ? ov.returnsCategories || [] : ov.categories || [];
    var note =
      tab === "returns"
        ? ov.returnsSignedNote || ""
        : (ov.vatNote || "") + " Источник: " + (ov.salesSource || "none") + ".";
    return (
      '<div class="sales-section-toolbar">' +
      '<label>Месяц <select id="sales-month-select" data-testid="sales-month-select"></select></label>' +
      '<div class="sales-section-tabs" role="tablist">' +
      '<button type="button" class="sales-section-tab" data-tab="sales" aria-selected="' +
      (tab === "sales" ? "true" : "false") +
      '">Продажи</button>' +
      '<button type="button" class="sales-section-tab" data-tab="returns" aria-selected="' +
      (tab === "returns" ? "true" : "false") +
      '">Возвраты</button>' +
      "</div></div>" +
      '<p class="sales-note" data-testid="sales-source-note">' +
      esc(note) +
      "</p>" +
      '<p class="sales-note">' +
      esc(ov.periodComparisonNote || "") +
      "</p>" +
      '<div id="sales-drill-panel" data-testid="sales-drill-panel"></div>' +
      renderMacroGrid(macro, tab === "returns" ? "sales-returns-macro" : "sales-macro") +
      renderCategoryTable(
        categories,
        tab === "returns" ? "sales-returns-categories" : "sales-categories",
        month,
        tab,
      )
    );
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

  function bindDrillHandlers(activeTab) {
    root.querySelectorAll("[data-drill-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var productType = btn.getAttribute("data-drill-category") || "";
        var month = btn.getAttribute("data-drill-month") || "";
        var kind = btn.getAttribute("data-drill-kind") || activeTab;
        var panel = document.getElementById("sales-drill-panel");
        if (!panel) {
          return;
        }
        panel.innerHTML = '<p class="sales-note">Загрузка товаров…</p>';
        api.apiRequest(buildSkuUrl(month, productType, kind)).then(function (result) {
          if (result.response.status !== 200) {
            panel.innerHTML =
              '<p class="sales-empty">Детализация по товарам недоступна для выбранного периода.</p>';
            return;
          }
          var items = result.data.items || [];
          if (!items.length) {
            panel.innerHTML = '<p class="sales-empty">Нет товаров в области видимости.</p>';
            return;
          }
          var html =
            '<table class="sales-category-table" data-testid="sales-sku-table"><thead><tr><th>Товар</th><th>Кол-во</th><th>Выручка</th></tr></thead><tbody>';
          items.forEach(function (row) {
            html +=
              "<tr><td>" +
              esc(row.nameItem) +
              "</td><td>" +
              formatNum(row.quantity) +
              "</td><td>" +
              formatNum(row.income) +
              "</td></tr>";
          });
          html += "</tbody></table>";
          panel.innerHTML = html;
        });
      });
    });
  }

  function loadOverview(month, activeTab) {
    var gen = ++loadGeneration;
    root.innerHTML = '<p class="sales-note">Загрузка…</p>';
    return api
      .apiRequest(buildOverviewUrl(month))
      .then(function (result) {
        if (gen !== loadGeneration) {
          return;
        }
        if (result.response.status !== 200) {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-error">Не удалось загрузить данные продаж. <button type="button" id="sales-retry">Повторить</button></div>';
          document.getElementById("sales-retry")?.addEventListener("click", function () {
            loadOverview(month, activeTab);
          });
          return;
        }
        root.innerHTML = renderOverview(result.data, activeTab, month);
        fillMonthSelect(cachedMonths.length ? cachedMonths : [month], month);
        var monthSelect = document.getElementById("sales-month-select");
        if (monthSelect) {
          monthSelect.addEventListener("change", function () {
            setMonthInUrl(monthSelect.value);
            loadOverview(monthSelect.value, activeTab);
          });
        }
        root.querySelectorAll(".sales-section-tab[data-tab]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var tab = btn.getAttribute("data-tab") || "sales";
            loadOverview(monthSelect ? monthSelect.value : month, tab);
          });
        });
        bindDrillHandlers(activeTab);
      })
      .catch(function () {
        if (gen !== loadGeneration) {
          return;
        }
        root.innerHTML =
          '<div class="sales-empty" data-testid="sales-error">Ошибка сети. <button type="button" id="sales-retry">Повторить</button></div>';
        document.getElementById("sales-retry")?.addEventListener("click", function () {
          loadOverview(month, activeTab);
        });
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
              '<div class="sales-empty" data-testid="sales-schema-not-ready">Схема продаж ещё не применена. Данные из 1С недоступны.</div>';
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
          loadOverview(month, "sales");
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
