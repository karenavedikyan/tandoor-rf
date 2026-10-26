(function () {
  "use strict";

  var UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  function parseStrictSalesMonth(value) {
    if (!value || typeof value !== "string") {
      return { ok: false };
    }
    var trimmed = value.trim();
    var m = /^(\d{4})-(\d{2})$/.exec(trimmed);
    if (!m) {
      return { ok: false };
    }
    var monthNum = Number(m[2]);
    if (monthNum < 1 || monthNum > 12) {
      return { ok: false };
    }
    return { ok: true, yyyyMm: m[1] + "-" + m[2] };
  }

  function isValidUuid(value) {
    return typeof value === "string" && UUID_RE.test(value.trim());
  }

  function monthFromUrl() {
    return new URLSearchParams(window.location.search).get("v3salesMonth") || "";
  }

  function resolveBackHrefFromLocation() {
    var raw = new URLSearchParams(window.location.search).get("return");
    if (typeof raw === "string" && raw !== "") {
      if (raw.startsWith("/clients") || raw.startsWith("/sales")) {
        return raw;
      }
      if (raw.startsWith("?")) {
        return "/clients" + raw;
      }
      return "/clients?" + raw;
    }
    return "/clients?v3mode=1";
  }

  function setMonthInUrl(month, options) {
    options = options || {};
    var url = new URL(window.location.href);
    if (month) {
      url.searchParams.set("v3salesMonth", month);
    } else {
      url.searchParams.delete("v3salesMonth");
    }
    var ret = url.searchParams.get("return");
    if (ret) {
      var returnIsPath = ret.charAt(0) === "/";
      var returnUrl = new URL(returnIsPath ? ret : "/clients" + (ret.charAt(0) === "?" ? ret : "?" + ret), window.location.origin);
      var retParams = returnUrl.searchParams;
      if (month) {
        retParams.set("v3salesMonth", month);
      } else {
        retParams.delete("v3salesMonth");
      }
      url.searchParams.set("return", (returnIsPath ? returnUrl.pathname : "") + "?" + retParams.toString());
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (options.syncBackHref !== false) {
      var back = document.querySelector('[data-testid="v3-back-to-list"]');
      if (back) {
        back.setAttribute("href", resolveBackHrefFromLocation());
      }
    }
    if (options.onMonthChange) {
      options.onMonthChange(month, url);
    }
  }

  function returnQueryFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var ret = params.get("return");
    if (!ret) return "";
    return ret.startsWith("?") ? ret : "?" + ret;
  }

  function normalizeListReturnSearch(returnRaw) {
    if (!returnRaw) {
      return returnQueryFromLocation();
    }
    if (returnRaw.startsWith("?")) {
      return returnRaw;
    }
    if (returnRaw.startsWith("/clients") || returnRaw.startsWith("/sales")) {
      return new URL(returnRaw, window.location.origin).search;
    }
    return "?" + returnRaw;
  }

  function assertTerritoryStateValid(state) {
    if (!state) return;
    if (state.v3manager && !isValidUuid(state.v3manager)) {
      throw new Error("invalid_territory");
    }
    if (state.ropEmployee && !isValidUuid(state.ropEmployee)) {
      throw new Error("invalid_territory");
    }
    if (state.orgTeamGuid && !isValidUuid(state.orgTeamGuid)) {
      throw new Error("invalid_territory");
    }
    if (state.responsibleGuid && !isValidUuid(state.responsibleGuid)) {
      throw new Error("invalid_territory");
    }
    if (state.orgCatalogEntry && !isValidUuid(state.orgCatalogEntry)) {
      throw new Error("invalid_territory");
    }
    if (
      state.responsibleKind &&
      ["manager", "regional", "hardware"].indexOf(state.responsibleKind) < 0
    ) {
      throw new Error("invalid_territory");
    }
  }

  function territoryQueryFromState(state) {
    var q = new URLSearchParams();
    if (!state) {
      return "";
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

  function listReturnParamsToState(search) {
    var params = new URLSearchParams(search.charAt(0) === "?" ? search.slice(1) : search);
    var v3manager = params.get("v3manager") || "";
    var responsibleGuid = params.get("responsibleGuid") || "";
    if (!responsibleGuid && v3manager) {
      responsibleGuid = v3manager;
    }
    var responsibleKind = params.get("responsibleKind") || params.get("teamKind") || "manager";
    return {
      v3manager: v3manager,
      ropEmployee: params.get("ropEmployee") || "",
      orgTeamGuid: params.get("orgTeamGuid") || "",
      orgCatalogEntry: params.get("orgCatalogEntry") || "",
      responsibleGuid: responsibleGuid,
      responsibleKind: responsibleGuid ? responsibleKind : "",
      v3view: params.get("v3view") || "all",
    };
  }

  function territoryQueryFromListReturn(returnRaw) {
    var search = normalizeListReturnSearch(returnRaw);
    if (search) {
      var state =
        window.ClientsV3 && window.ClientsV3.readState
          ? window.ClientsV3.readState(search)
          : listReturnParamsToState(search);
      assertTerritoryStateValid(state);
      return territoryQueryFromState(state);
    }
    return territoryQueryFromLocation();
  }

  function territoryQueryFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var q = new URLSearchParams();
    ["responsibleGuid", "responsibleKind", "ropBranchGuid", "managerGuid", "teamGuid", "employeePortfolioGuid"].forEach(
      function (key) {
        var v = params.get(key);
        if (v) {
          if (!isValidUuid(v) && key.indexOf("Kind") < 0) {
            throw new Error("invalid_territory");
          }
          q.set(key, v);
        }
      },
    );
    var s = q.toString();
    return s ? "?" + s : "";
  }

  function fetchMonths(api, territoryQuery) {
    var q = territoryQuery || "";
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

  function fetchCardSummary(api, entity, guid, month, territoryQuery) {
    var tq = (territoryQuery || "").replace(/^\?/, "&");
    var q =
      "?entity=" +
      encodeURIComponent(entity) +
      "&guid=" +
      encodeURIComponent(guid) +
      "&month=" +
      encodeURIComponent(month) +
      tq;
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
        '<td class="num">' +
        incomeCell +
        "</td>" +
        '<td class="num">' +
        qtyCell +
        "</td>" +
        '<td class="num">' +
        share +
        "</td>" +
        '<td><a class="pc-link" href="' +
        esc(shell, salesDetailsPath(row.salesTabPath)) +
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

  function salesDetailsPath(path) {
    var target = new URL(window.location.href);
    target.searchParams.set("cardTab", "sales");
    ["salesView", "salesCategory", "salesQ", "salesPage", "salesLegal"].forEach(function (key) {
      target.searchParams.delete(key);
    });
    if (path) {
      target.searchParams.set("salesLegal", new URL(path, window.location.origin).pathname.split("/").pop());
    }
    return target.pathname + target.search;
  }

  function buildMonthSelectOptions(shell, months, selectedMonth, requestedUnavailable) {
    var html = "";
    if (requestedUnavailable && selectedMonth && months.indexOf(selectedMonth) < 0) {
      html +=
        '<option value="' +
        esc(shell, selectedMonth) +
        '" selected>' +
        esc(shell, selectedMonth) +
        " (нет данных)</option>";
    }
    (months || []).forEach(function (m) {
      html +=
        '<option value="' +
        esc(shell, m) +
        '"' +
        (m === selectedMonth ? " selected" : "") +
        ">" +
        esc(shell, m) +
        "</option>";
    });
    return html;
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
      note += '<p class="pc-unavailable" data-testid="v3-sales-month-unavailable">За выбранный месяц нет данных в вашей области видимости.</p>';
    }
    var monthOptions = buildMonthSelectOptions(shell, months, summary.month, monthUnavailable);
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
      '<p><a class="btn btn--primary" data-testid="v3-sales-open-detail" href="' +
      esc(shell, salesDetailsPath("")) + '">Смотреть детализацию</a></p>' +
      renderBreakdownTable(shell, summary, entityType) +
      "</section>"
    );
  }

  function mountOverview(host, options) {
    if (!host || !options.api || !options.entityType) return;
    if (options.entityType === "retail") return;
    var loadSeq = 0;
    var territoryQuery;
    try {
      territoryQuery =
        options.territoryQuery ||
        territoryQueryFromListReturn(options.returnQuery || returnQueryFromLocation());
    } catch (_err) {
      host.innerHTML =
        '<section class="v3-sales-summary-block"><p class="pc-unavailable">Некорректные параметры территории в ссылке возврата.</p></section>';
      return;
    }
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

    function bindMonthSelect(select, months, summary, requestedUnavailable) {
      if (!select) return;
      select.addEventListener("change", function () {
        var v = select.value;
        setMonthInUrl(v, { syncBackHref: true, onMonthChange: options.onMonthChange });
        load(v, months, months.indexOf(v) < 0);
      });
    }

    function load(month, months, requestedUnavailable) {
      var seq = ++loadSeq;
      return fetchCardSummary(options.api, options.entityType, options.guid, month, territoryQuery)
        .then(function (payload) {
          if (seq !== loadSeq || !host.isConnected) return;
          if (payload.denied || !payload.summary) {
            renderError("Нет доступа к продажам по этому объекту.", false);
            return;
          }
          var summary = payload.summary;
          host.innerHTML = renderBlock(options.shell, summary, options.entityType, months, requestedUnavailable);
          bindMonthSelect(
            host.querySelector("[data-testid='v3-client-sales-month']"),
            months,
            summary,
            requestedUnavailable,
          );
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
          var fromUrl = monthFromUrl();
          var parsed = parseStrictSalesMonth(fromUrl);
          if (fromUrl && !parsed.ok) {
            renderError("Некорректный месяц в адресе (ожидается YYYY-MM).", false);
            return;
          }
          if (!fromUrl && !months.length) {
            host.innerHTML =
              '<section class="v3-sales-summary-block"><p class="pc-unavailable">Нет доступных месяцев продаж.</p></section>';
            return;
          }
          var monthToLoad = fromUrl || months[0];
          if (!fromUrl && months[0]) {
            setMonthInUrl(months[0], { syncBackHref: true, onMonthChange: options.onMonthChange });
          }
          var requestedUnavailable = Boolean(fromUrl && months.indexOf(monthToLoad) < 0);
          return load(monthToLoad, months, requestedUnavailable);
        })
        .catch(function () {
          if (seq !== loadSeq || !host.isConnected) return;
          renderError("Не удалось загрузить список месяцев.", true);
        });
    }

    bootstrap();
  }

  function fetchBatch(api, month, targets, territoryQuery) {
    var params = new URLSearchParams((territoryQuery || "").replace(/^\?/, ""));
    params.set("month", month);
    (targets || []).forEach(function (target) {
      params.append("target", target.kind + ":" + target.guid);
    });
    var url = "/api/clients/v3/client-sales/batch?" + params.toString();
    return api
      .apiRequest(url)
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

  function partialScopeSuffix(sales) {
    if (sales && sales.scopeLimited && sales.dataState === "loaded") {
      return ' <span class="clients-v3-sales-partial-note" title="Доступная часть">*</span>';
    }
    return "";
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
      if (
        colId === "sales_income_total" ||
        colId === "sales_quantity_total" ||
        colId === "sales_legal_count"
      ) {
        return '<span class="clients-no-data">—</span>';
      }
    }
    if (colId === "sales_income_total") {
      return sales.dataState === "loaded"
        ? esc(shell, formatMoney(sales.incomeTotal)) + partialScopeSuffix(sales)
        : '<span class="clients-no-data">—</span>';
    }
    if (colId === "sales_quantity_total") {
      return sales.dataState === "loaded"
        ? esc(shell, formatQty(sales.quantityTotal)) + partialScopeSuffix(sales)
        : '<span class="clients-no-data">—</span>';
    }
    if (colId === "sales_legal_count") {
      return sales.dataState === "loaded" && sales.legalWithSalesCount != null
        ? esc(shell, String(sales.legalWithSalesCount)) + partialScopeSuffix(sales)
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
      return '<span class="clients-v3-sales-by-legal">' + parts.join("<br>") + note + "</span>";
    }
    return '<span class="clients-no-data">—</span>';
  }

  window.ClientSalesSummaryUi = {
    monthFromUrl: monthFromUrl,
    setMonthInUrl: setMonthInUrl,
    mountOverview: mountOverview,
    listReturnParamsToState: listReturnParamsToState,
    formatMoney: formatMoney,
    formatQty: formatQty,
    unwrapApiResult: unwrapApiResult,
    territoryQueryFromState: territoryQueryFromState,
    territoryQueryFromListReturn: territoryQueryFromListReturn,
    parseStrictSalesMonth: parseStrictSalesMonth,
    fetchBatch: fetchBatch,
    fetchMonths: fetchMonths,
    formatListSalesCell: formatListSalesCell,
  };
})();
