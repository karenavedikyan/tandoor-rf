(function () {
  "use strict";

  function esc(shell, value) {
    return shell && shell.escapeHtml ? shell.escapeHtml(String(value)) : String(value);
  }

  function formatMoney(value) {
    if (value == null || value === "") return "—";
    var num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
  }

  function formatQty(value) {
    if (value == null || value === "") return "—";
    var num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return num.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  }

  function monthFromUrl() {
    return new URLSearchParams(window.location.search).get("v3salesMonth") || "";
  }

  function setMonthInUrl(month) {
    var url = new URL(window.location.href);
    if (month) {
      url.searchParams.set("v3salesMonth", month);
    } else {
      url.searchParams.delete("v3salesMonth");
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function territoryQueryFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var q = new URLSearchParams();
    ["responsibleGuid", "responsibleKind", "ropBranchGuid", "managerGuid", "teamGuid", "employeePortfolioGuid"].forEach(
      function (key) {
        var v = params.get(key);
        if (v) q.set(key, v);
      },
    );
    var s = q.toString();
    return s ? "&" + s : "";
  }

  function fetchMonths(api) {
    return api.apiRequest("/api/clients/v3/client-sales/months" + territoryQueryFromLocation().replace(/^&/, "?"));
  }

  function fetchCardSummary(api, entity, guid, month) {
    var q =
      "?entity=" +
      encodeURIComponent(entity) +
      "&guid=" +
      encodeURIComponent(guid) +
      "&month=" +
      encodeURIComponent(month) +
      territoryQueryFromLocation();
    return api.apiRequest("/api/clients/v3/client-sales/card" + q);
  }

  function renderTiles(shell, summary) {
    var income =
      summary.dataState === "loaded" ? formatMoney(summary.incomeTotal) : '<span class="pc-unavailable">—</span>';
    var qty =
      summary.dataState === "loaded" ? formatQty(summary.quantityTotal) : '<span class="pc-unavailable">—</span>';
    var legalCount =
      summary.dataState === "loaded" && summary.legalEntitiesWithSalesCount != null
        ? esc(shell, String(summary.legalEntitiesWithSalesCount))
        : '<span class="pc-unavailable">—</span>';
    return (
      '<div class="v3-sales-summary-tiles" data-testid="v3-sales-summary-tiles">' +
      '<div class="v3-sales-tile"><span class="pc-label">Продажи, ₽</span><b>' +
      income +
      "</b></div>" +
      '<div class="v3-sales-tile"><span class="pc-label">Единицы</span><b>' +
      qty +
      "</b></div>" +
      '<div class="v3-sales-tile"><span class="pc-label">Юрлица с продажами</span><b>' +
      legalCount +
      "</b></div>" +
      "</div>"
    );
  }

  function renderBreakdownTable(shell, summary, entityType) {
    if (entityType !== "holding" && entityType !== "legal") {
      return "";
    }
    var rows = summary.breakdown || [];
    if (!rows.length && entityType === "legal") {
      return "";
    }
    var body = "";
    rows.forEach(function (row) {
      var incomeCell =
        row.rowStatus === "has_sales"
          ? formatMoney(row.income)
          : row.rowStatus === "known_zero"
            ? "0,00 ₽"
            : '<span class="pc-unavailable">—</span>';
      var qtyCell =
        row.rowStatus === "has_sales"
          ? formatQty(row.quantity)
          : row.rowStatus === "known_zero"
            ? "0"
            : '<span class="pc-unavailable">—</span>';
      var share =
        row.sharePercent != null ? esc(shell, row.sharePercent + "%") : '<span class="pc-unavailable">—</span>';
      body +=
        "<tr>" +
        "<td>" +
        esc(shell, row.name) +
        "</td>" +
        "<td>" +
        (row.inn ? esc(shell, row.inn) : '<span class="pc-unavailable">—</span>') +
        "</td>" +
        "<td>" +
        incomeCell +
        "</td>" +
        "<td>" +
        qtyCell +
        "</td>" +
        "<td>" +
        share +
        "</td>" +
        '<td><a class="pc-link" href="' +
        esc(shell, row.salesTabPath) +
        '" data-v3-sales-details="1">Подробнее</a></td>' +
        "</tr>";
    });
    var totalIncome =
      summary.dataState === "loaded" ? formatMoney(summary.incomeTotal) : '<span class="pc-unavailable">—</span>';
    var totalQty =
      summary.dataState === "loaded" ? formatQty(summary.quantityTotal) : '<span class="pc-unavailable">—</span>';
    body +=
      '<tr class="v3-sales-breakdown-total"><td colspan="2"><b>Итого (доступная часть)</b></td><td><b>' +
      totalIncome +
      "</b></td><td><b>" +
      totalQty +
      '</b></td><td colspan="2"></td></tr>';
    return (
      '<div class="v3-sales-breakdown-wrap" data-testid="v3-sales-breakdown">' +
      '<table class="v3-sales-breakdown-table"><thead><tr>' +
      "<th>Юрлицо</th><th>ИНН</th><th>Сумма</th><th>Ед.</th><th>Доля</th><th></th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table></div>"
    );
  }

  function renderBlock(shell, summary, entityType) {
    var note = "";
    if (summary.scopeLimited) {
      note =
        '<p class="pc-label v3-sales-scope-note">Показаны продажи только по юрлицам в вашей области видимости, не по всему холдингу.</p>';
    }
    if (summary.dataState === "schema_not_ready") {
      note += '<p class="pc-unavailable">Данные продаж ещё не готовы (схема импорта).</p>';
    } else if (summary.dataState === "month_not_imported") {
      note += '<p class="pc-unavailable">За выбранный месяц нет загруженных агрегатов продаж.</p>';
    }
    return (
      '<section class="v3-sales-summary-block" aria-label="Продажи за месяц" data-testid="v3-client-sales-summary">' +
      '<div class="v3-sales-summary-head">' +
      '<h3 class="v3-sales-summary-title">Продажи</h3>' +
      '<label class="v3-sales-month-label">Месяц <select data-testid="v3-client-sales-month"></select></label>' +
      "</div>" +
      note +
      renderTiles(shell, summary) +
      renderBreakdownTable(shell, summary, entityType) +
      "</section>"
    );
  }

  function mountOverview(host, options) {
    if (!host || !options.api || !options.entityType) return;
    if (options.entityType === "retail") return;
    var loadSeq = 0;
    host.innerHTML = '<p class="pc-unavailable">Загрузка продаж…</p>';

    function load(month) {
      var seq = ++loadSeq;
      return fetchCardSummary(options.api, options.entityType, options.guid, month).then(function (payload) {
        if (seq !== loadSeq) return;
        var summary = payload.summary;
        host.innerHTML = renderBlock(options.shell, summary, options.entityType);
        var select = host.querySelector("[data-testid='v3-client-sales-month']");
        return fetchMonths(options.api).then(function (monthsPayload) {
          if (seq !== loadSeq || !select) return;
          var months = monthsPayload.months || [];
          select.innerHTML = "";
          months.forEach(function (m) {
            var opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            if (m === summary.month) opt.selected = true;
            select.appendChild(opt);
          });
          select.addEventListener("change", function () {
            var v = select.value;
            setMonthInUrl(v);
            load(v);
          });
          host.querySelectorAll("[data-v3-sales-details]").forEach(function (link) {
            link.addEventListener("click", function (ev) {
              ev.preventDefault();
              var tab = "sales";
              var url = new URL(window.location.href);
              url.searchParams.set("cardTab", tab);
              if (select.value) url.searchParams.set("v3salesMonth", select.value);
              window.history.replaceState({}, "", url.pathname + url.search);
              if (options.onOpenSalesTab) options.onOpenSalesTab();
            });
          });
        });
      });
    }

    fetchMonths(options.api).then(function (monthsPayload) {
      var months = monthsPayload.months || [];
      var fromUrl = monthFromUrl();
      var month = fromUrl && months.indexOf(fromUrl) >= 0 ? fromUrl : months[0];
      if (!month) {
        host.innerHTML =
          '<section class="v3-sales-summary-block"><p class="pc-unavailable">Нет доступных месяцев продаж.</p></section>';
        return;
      }
      setMonthInUrl(month);
      return load(month);
    });
  }

  window.ClientSalesSummaryUi = {
    monthFromUrl: monthFromUrl,
    setMonthInUrl: setMonthInUrl,
    mountOverview: mountOverview,
    formatMoney: formatMoney,
    formatQty: formatQty,
    fetchBatch: function (api, month, targets) {
      return api.apiRequest("/api/clients/v3/client-sales/batch", {
        method: "POST",
        body: JSON.stringify({ month: month, targets: targets }),
      });
    },
  };
})();
