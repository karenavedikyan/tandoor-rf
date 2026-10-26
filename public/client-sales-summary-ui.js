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

  function unwrapApiResult(result) {
    if (!result || typeof result !== "object") {
      return { ok: false, status: 0, data: null };
    }
    var response = result.response || {};
    var status = Number(response.status || 0);
    var ok = response.ok === true || (status >= 200 && status < 300);
    return { ok: ok, status: status, data: result.data != null ? result.data : null };
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

  function returnQueryFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var ret = params.get("return");
    if (!ret) return "";
    return ret.startsWith("?") ? ret : "?" + ret;
  }

  function territoryQueryFromState(state) {
    var q = new URLSearchParams();
    if (!state) {
      return territoryQueryFromLocation();
    }
    if (state.ropEmployee) q.set("ropBranchGuid", state.ropEmployee);
    if (state.orgTeamGuid) q.set("teamGuid", state.orgTeamGuid);
    var teamAssignment =
      state.responsibleGuid &&
      state.responsibleKind &&
      (state.v3view === "teams" || state.ropEmployee);
    if (state.orgCatalogEntry && state.responsibleGuid) {
      q.set("employeePortfolioGuid", state.responsibleGuid);
    } else if (teamAssignment) {
      q.set("responsibleGuid", state.responsibleGuid);
      q.set("responsibleKind", state.responsibleKind || "manager");
    }
    if (state.v3manager && !teamAssignment) {
      q.set("managerGuid", state.v3manager);
    }
    var s = q.toString();
    return s ? "?" + s : "";
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
    return s ? "?" + s : "";
  }

  function fetchMonths(api, territoryQuery) {
    var q = territoryQuery || territoryQueryFromLocation();
    return api.apiRequest("/api/clients/v3/client-sales/months" + q).then(function (result) {
      var unwrapped = unwrapApiResult(result);
      if (unwrapped.status === 401) {
        window.location.replace("/login");
        return Promise.reject(new Error("unauthorized"));
      }
      if (unwrapped.status === 403) {
        return { months: [], dataState: "forbidden" };
      }
      if (!unwrapped.ok || !unwrapped.data) {
        return Promise.reject(new Error("months_load_failed"));
      }
      return unwrapped.data;
    });
  }

  function fetchCardSummary(api, entity, guid, month, territoryQuery, returnQuery) {
    var q =
      "?entity=" +
      encodeURIComponent(entity) +
      "&guid=" +
      encodeURIComponent(guid) +
      "&month=" +
      encodeURIComponent(month) +
      (territoryQuery || territoryQueryFromLocation()).replace(/^\?/, "&");
    return api.apiRequest("/api/clients/v3/client-sales/card" + q).then(function (result) {
      var unwrapped = unwrapApiResult(result);
      if (unwrapped.status === 401) {
        window.location.replace("/login");
        return Promise.reject(new Error("unauthorized"));
      }
      if (unwrapped.status === 403 || unwrapped.status === 404) {
        return { summary: null, denied: true };
      }
      if (!unwrapped.ok || !unwrapped.data || !unwrapped.data.summary) {
        return Promise.reject(new Error("card_load_failed"));
      }
      return { summary: unwrapped.data.summary, denied: false };
    });
  }

  function renderTiles(shell, summary) {
    var loaded = summary.dataState === "loaded";
    var income = loaded ? formatMoney(summary.incomeTotal) : '<span class="pc-unavailable">—</span>';
    var qty = loaded ? formatQty(summary.quantityTotal) : '<span class="pc-unavailable">—</span>';
    var legalCount =
      loaded && summary.legalEntitiesWithSalesCount != null
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
        "<td class=\"num\">" +
        incomeCell +
        "</td>" +
        "<td class=\"num\">" +
        qtyCell +
        "</td>" +
        "<td class=\"num\">" +
        share +
        "</td>" +
        '<td><a class="pc-link" href="' +
        esc(shell, row.salesTabPath) +
        '" data-testid="v3-sales-details-link">Подробнее</a></td>' +
        "</tr>";
    });
    var totalLabel = summary.scopeLimited ? "Итого (доступная часть)" : "Итого";
    var totalIncome =
      summary.dataState === "loaded" ? formatMoney(summary.incomeTotal) : '<span class="pc-unavailable">—</span>';
    var totalQty =
      summary.dataState === "loaded" ? formatQty(summary.quantityTotal) : '<span class="pc-unavailable">—</span>';
    body +=
      '<tr class="v3-sales-breakdown-total"><td colspan="2"><b>' +
      esc(shell, totalLabel) +
      "</b></td><td class=\"num\"><b>" +
      totalIncome +
      "</b></td><td class=\"num\"><b>" +
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

  function renderBlock(shell, summary, entityType, months, monthUnavailable) {
    var note = "";
    if (summary.scopeLimited) {
      note =
        '<p class="pc-label v3-sales-scope-note">Показаны продажи только по юрлицам в вашей области видимости (доступная часть).</p>';
    }
    if (summary.dataState === "schema_not_ready") {
      note += '<p class="pc-unavailable">Данные продаж ещё не готовы (схема импорта).</p>';
    } else if (summary.dataState === "month_not_imported") {
      note += '<p class="pc-unavailable">За выбранный месяц нет загруженных агрегатов продаж.</p>';
    } else if (summary.dataState === "incomplete") {
      note +=
        '<p class="pc-unavailable">Не все юрлица имеют загруженные данные за месяц; итоги и доли скрыты.</p>';
    } else if (summary.dataState === "unavailable") {
      note += '<p class="pc-unavailable">Нет доступных юрлиц для расчёта продаж.</p>';
    }
    if (monthUnavailable) {
      note += '<p class="pc-unavailable">Запрошенный месяц недоступен; выберите другой из списка.</p>';
    }
    var monthOptions = (months || [])
      .map(function (m) {
        return (
          '<option value="' +
          esc(shell, m) +
          '"' +
          (m === summary.month ? " selected" : "") +
          ">" +
          esc(shell, m) +
          "</option>"
        );
      })
      .join("");
    return (
      '<section class="v3-sales-summary-block" aria-label="Продажи за месяц" data-testid="v3-client-sales-summary">' +
      '<div class="v3-sales-summary-head">' +
      '<h3 class="v3-sales-summary-title">Продажи</h3>' +
      '<label class="v3-sales-month-label">Месяц <select data-testid="v3-client-sales-month">' +
      monthOptions +
      "</select></label>" +
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
    var territoryQuery = options.territoryQuery || territoryQueryFromLocation();
    var returnQuery = options.returnQuery || returnQueryFromLocation();
    host.innerHTML = '<p class="pc-unavailable">Загрузка продаж…</p>';

    function renderError(message, retry) {
      host.innerHTML =
        '<section class="v3-sales-summary-block"><p class="pc-unavailable">' +
        esc(options.shell, message) +
        '</p>' +
        (retry
          ? '<button type="button" class="workspace-button workspace-button--primary" data-v3-sales-retry>Повторить</button>'
          : "") +
        "</section>";
      var btn = host.querySelector("[data-v3-sales-retry]");
      if (btn) {
        btn.addEventListener("click", function () {
          bootstrap();
        });
      }
    }

    function bindMonthSelect(select, months, summary) {
      if (!select) return;
      select.addEventListener("change", function () {
        var v = select.value;
        setMonthInUrl(v);
        load(v, months);
      });
    }

    function load(month, months) {
      var seq = ++loadSeq;
      return fetchCardSummary(options.api, options.entityType, options.guid, month, territoryQuery, returnQuery)
        .then(function (payload) {
          if (seq !== loadSeq || !host.isConnected) return;
          if (payload.denied || !payload.summary) {
            renderError("Нет доступа к продажам по этому объекту.", false);
            return;
          }
          var summary = payload.summary;
          var monthUnavailable = Boolean(monthFromUrl() && months.indexOf(monthFromUrl()) < 0);
          host.innerHTML = renderBlock(options.shell, summary, options.entityType, months, monthUnavailable);
          bindMonthSelect(host.querySelector("[data-testid='v3-client-sales-month']"), months, summary);
        })
        .catch(function () {
          if (seq !== loadSeq || !host.isConnected) return;
          renderError("Не удалось загрузить продажи.", true);
        });
    }

    function bootstrap() {
      var seq = ++loadSeq;
      fetchMonths(options.api, territoryQuery)
        .then(function (monthsPayload) {
          if (seq !== loadSeq || !host.isConnected) return;
          var months = monthsPayload.months || [];
          if (!months.length) {
            host.innerHTML =
              '<section class="v3-sales-summary-block"><p class="pc-unavailable">Нет доступных месяцев продаж.</p></section>';
            return;
          }
          var fromUrl = monthFromUrl();
          var requestedMissing = fromUrl && months.indexOf(fromUrl) < 0;
          var month = fromUrl && months.indexOf(fromUrl) >= 0 ? fromUrl : months[0];
          if (!requestedMissing) {
            setMonthInUrl(month);
          }
          return load(month, months);
        })
        .catch(function () {
          if (seq !== loadSeq || !host.isConnected) return;
          renderError("Не удалось загрузить список месяцев.", true);
        });
    }

    bootstrap();
  }

  function fetchBatch(api, month, targets, territoryQuery) {
    var tq = territoryQuery || territoryQueryFromLocation();
    var url = "/api/clients/v3/client-sales/batch" + (tq || "");
    return api
      .apiRequest(url, {
        method: "POST",
        body: { month: month, targets: targets || [] },
      })
      .then(function (result) {
      var unwrapped = unwrapApiResult(result);
      if (unwrapped.status === 401) {
        window.location.replace("/login");
        return Promise.reject(new Error("unauthorized"));
      }
      if (!unwrapped.ok) {
        return Promise.reject(new Error("batch_load_failed"));
      }
      return unwrapped.data || { summaries: {} };
    });
  }

  function formatListSalesCell(sales, colId, shell) {
    if (!sales) {
      return '<span class="clients-no-data">—</span>';
    }
    if (sales.dataState === "month_not_imported" || sales.dataState === "schema_not_ready") {
      return '<span class="clients-no-data">—</span>';
    }
    if (sales.dataState === "unavailable") {
      return '<span class="clients-no-data">н/д</span>';
    }
    if (sales.dataState === "incomplete") {
      if (colId === "sales_income_total" || colId === "sales_quantity_total" || colId === "sales_legal_count") {
        return '<span class="clients-no-data">—</span>';
      }
    }
    if (colId === "sales_income_total") {
      return sales.dataState === "loaded"
        ? esc(shell, formatMoney(sales.incomeTotal))
        : '<span class="clients-no-data">—</span>';
    }
    if (colId === "sales_quantity_total") {
      return sales.dataState === "loaded"
        ? esc(shell, formatQty(sales.quantityTotal))
        : '<span class="clients-no-data">—</span>';
    }
    if (colId === "sales_legal_count") {
      return sales.dataState === "loaded" && sales.legalWithSalesCount != null
        ? esc(shell, String(sales.legalWithSalesCount))
        : '<span class="clients-no-data">—</span>';
    }
    if (colId === "sales_by_legal") {
      var rows = sales.breakdown || [];
      if (!rows.length) {
        return '<span class="clients-no-data">—</span>';
      }
      var parts = rows.map(function (row) {
        var amount =
          row.rowStatus === "has_sales"
            ? formatMoney(row.income)
            : row.rowStatus === "known_zero"
              ? "0,00 ₽"
              : "—";
        return esc(shell, row.name) + ": " + esc(shell, amount);
      });
      var note = sales.scopeLimited
        ? ' <span class="clients-v3-sales-partial-note">(доступная часть)</span>'
        : "";
      return (
        '<span class="clients-v3-sales-by-legal">' + parts.join("<br>") + note + "</span>"
      );
    }
    return '<span class="clients-no-data">—</span>';
  }

  window.ClientSalesSummaryUi = {
    monthFromUrl: monthFromUrl,
    setMonthInUrl: setMonthInUrl,
    mountOverview: mountOverview,
    formatMoney: formatMoney,
    formatQty: formatQty,
    unwrapApiResult: unwrapApiResult,
    territoryQueryFromState: territoryQueryFromState,
    fetchBatch: fetchBatch,
    formatListSalesCell: formatListSalesCell,
  };
})();
