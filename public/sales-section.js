(function () {
  "use strict";

  var root = document.getElementById("sales-section-root");
  var subtitle = document.getElementById("sales-page-subtitle");
  var loadGeneration = 0;

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

  function buildOverviewUrl(month) {
    var params = queryParams();
    params.set("month", month);
    return "/api/clients/v3/sales/overview?" + params.toString();
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

  function renderCategoryTable(rows, testId) {
    if (!rows || !rows.length) {
      return "";
    }
    var html =
      '<table class="sales-category-table" data-testid="' +
      esc(testId) +
      '"><thead><tr><th>Категория</th><th>Кол-во, шт</th><th>Выручка, ₽</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      html +=
        "<tr><td>" +
        esc(row.productType) +
        "</td><td>" +
        formatNum(row.quantity) +
        "</td><td>" +
        formatNum(row.income) +
        "</td></tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function renderOverview(data, activeTab) {
    var ov = data.overview || {};
    if (ov.dataState === "not_imported") {
      return (
        '<div class="sales-empty" data-testid="sales-not-imported">Нет загруженных данных из 1С.</div>'
      );
    }
    var tab = activeTab === "returns" ? "returns" : "sales";
    var macro =
      tab === "returns" ? ov.returnsMacroSummaries || [] : ov.macroSummaries || [];
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
      renderMacroGrid(macro, tab === "returns" ? "sales-returns-macro" : "sales-macro") +
      renderCategoryTable(
        categories,
        tab === "returns" ? "sales-returns-categories" : "sales-categories",
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
            '<div class="sales-empty" data-testid="sales-error">Не удалось загрузить данные продаж.</div>';
          return;
        }
        root.innerHTML = renderOverview(result.data, activeTab);
        fillMonthSelect([month], month);
        var monthSelect = document.getElementById("sales-month-select");
        if (monthSelect) {
          monthSelect.addEventListener("change", function () {
            loadOverview(monthSelect.value, activeTab);
          });
        }
        root.querySelectorAll(".sales-section-tab").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var tab = btn.getAttribute("data-tab") || "sales";
            loadOverview(monthSelect ? monthSelect.value : month, tab);
          });
        });
      })
      .catch(function () {
        if (gen !== loadGeneration) {
          return;
        }
        root.innerHTML =
          '<div class="sales-empty" data-testid="sales-error">Ошибка сети при загрузке продаж.</div>';
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
      api.apiRequest("/api/clients/v3/sales/months").then(function (monthsResult) {
        var months =
          monthsResult.response.status === 200 && monthsResult.data.months
            ? monthsResult.data.months
            : [];
        var params = queryParams();
        var month = params.get("month") || months[0] || "";
        if (subtitle) {
          subtitle.textContent = month ? "Период " + month : "";
        }
        if (!month) {
          root.innerHTML =
            '<div class="sales-empty" data-testid="sales-not-imported">Нет загруженных данных из 1С.</div>';
          return;
        }
        loadOverview(month, "sales");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
