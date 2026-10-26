(function () {
  "use strict";
  function e(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function number(value, money) {
    if (value == null || !Number.isFinite(Number(value))) return "Нет данных";
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: money ? 2 : 6,
    }).format(Number(value)) + (money ? " ₽" : "");
  }
  function state() {
    var p = new URLSearchParams(window.location.search);
    return { month: p.get("v3salesMonth") || "", legal: p.get("salesLegal") || "",
      category: p.has("salesCategory") ? p.get("salesCategory") : null, q: p.get("salesQ") || "", page: p.get("salesPage") || "1" };
  }
  function write(s) {
    var url = new URL(window.location.href);
    [["v3salesMonth", s.month], ["salesLegal", s.legal], ["salesCategory", s.category],
      ["salesQ", s.q], ["salesPage", s.page === "1" ? "" : s.page]].forEach(function (pair) {
      if (pair[1] || (pair[0] === "salesCategory" && pair[1] !== null)) url.searchParams.set(pair[0], pair[1]);
      else url.searchParams.delete(pair[0]);
    });
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    window.ClientSalesSummaryUi.setMonthInUrl(s.month, { syncBackHref: true });
  }
  function mount(host, options) {
    var seq = 0;
    var months = null;
    if (!host) return { load: function () {} };
    function load() {
      var token = ++seq;
      var s = state();
      host.innerHTML = '<p role="status">Загрузка детализации продаж…</p>';
      var helper = window.ClientSalesSummaryUi;
      var territory;
      try {
        territory = helper.territoryQueryFromListReturn(new URLSearchParams(window.location.search).get("return") || "");
      } catch (_error) {
        host.innerHTML = '<p role="alert">Некорректная выбранная территория. Вернитесь в список клиентов.</p>';
        return;
      }
      var ready = months ? Promise.resolve(months) : helper.fetchMonths(options.api, territory).then(function (data) {
        months = data.months || [];
        return months;
      });
      ready.then(function () {
        if (token !== seq || new URLSearchParams(window.location.search).get("cardTab") !== "sales") return null;
        if (!s.month) s.month = months[0] || "";
        if (!s.month) {
          host.innerHTML = '<p role="status">Нет доступных месяцев продаж.</p>';
          return null;
        }
        write(s);
        var p = new URLSearchParams(territory.replace(/^\?/, ""));
        p.set("entity", options.entity); p.set("guid", options.guid); p.set("month", s.month);
        if (s.legal) p.set("legalGuid", s.legal);
        if (s.category !== null) p.set("productType", s.category);
        if (s.q) p.set("q", s.q);
        p.set("page", s.page);
        return options.api.apiRequest("/api/clients/v3/client-sales/detail?" + p.toString());
      }).then(function (result) {
        if (!result || token !== seq) return;
        if (!result.response || result.response.status !== 200) throw new Error("unavailable");
        render(result.data, s);
      }).catch(function () {
        if (token !== seq) return;
        host.innerHTML = '<p role="alert">Детализация недоступна. Проверьте период и права доступа.</p>' +
          '<button type="button" data-csd-reset>Сбросить выбор и повторить</button>';
        host.querySelector("[data-csd-reset]").onclick = function () {
          s.legal = ""; s.category = null; s.q = ""; s.page = "1"; write(s); load();
        };
      });
    }
    function render(data, s) {
      var allMonths = months.slice();
      if (allMonths.indexOf(s.month) < 0) allMonths.unshift(s.month);
      var monthOptions = allMonths.map(function (month) {
        return '<option value="' + e(month) + '"' + (month === s.month ? " selected" : "") + ">" + e(month) + "</option>";
      }).join("");
      var legalOptions = '<option value="">Все юрлица клиента (доступная часть)</option>' +
        data.summary.breakdown.map(function (legal) {
          return '<option value="' + e(legal.legalGuid) + '"' + (s.legal === legal.legalGuid ? " selected" : "") + ">" +
            e(legal.name) + (legal.inn ? " · ИНН " + e(legal.inn) : "") + "</option>";
        }).join("");
      var overview = new URL(window.location.href);
      overview.searchParams.set("cardTab", "overview");
      var finance = new URL(window.location.href);
      finance.searchParams.set("salesView", "financial");
      var html = '<div class="csd" data-testid="csd-root"><h3>Детализация продаж</h3>' +
        '<p><a href="' + e(overview.pathname + overview.search) + '">К обзору клиента</a></p>' +
        '<div class="csd-toolbar"><label>Месяц<select data-testid="csd-month">' + monthOptions + '</select></label>' +
        '<label>Юрлицо<select data-testid="csd-legal">' + legalOptions + '</select></label></div>' +
        '<p class="pc-source">Показана доступная часть юрлиц в выбранной территории. Возвраты не вычитаются.</p>';
      if (s.category === null) {
        html += '<h4>Товарные категории</h4><div class="csd-categories">';
        html += data.categories.map(function (row) {
          return '<button type="button" data-csd-category="' + e(row.productType) + '">' +
            '<strong>' + e(row.productType || "Без категории") + '</strong><span>' + e(number(row.incomeTotal, true)) +
            '</span><span>' + e(number(row.quantityTotal, false)) + ' ед. · Смотреть товары</span></button>';
        }).join("");
        html += '</div>';
        if (!data.categories.length) html += '<p role="status">Месячные данные по выбранным условиям не загружены. Это не нулевые продажи.</p>';
      } else {
        var category = data.categories.filter(function (row) { return row.productType === s.category; })[0];
        html += '<p><button type="button" data-csd-back>Все категории</button></p><h4>' + e(s.category || "Без категории") + '</h4>';
        if (category) html += '<p class="csd-total">Месячный итог категории: <strong>' +
          e(number(category.incomeTotal, true)) + '</strong> · ' + e(number(category.quantityTotal, false)) + ' ед.</p>';
        if (data.itemTotals && data.itemTotals.incomeTotal != null) {
          html += '<p class="pc-source">В товарной выгрузке: ' + e(number(data.itemTotals.incomeTotal, true)) +
            ' · ' + e(number(data.itemTotals.quantityTotal, false)) + ' ед. Итоги относятся ко всей категории, не к текущей странице.</p>';
        }
        if (data.totalsDiffer) html += '<p role="status">Итоги месячной и товарной выгрузок различаются. Месячный итог не подменён суммой товарных строк.</p>';
        html += '<form class="csd-search" data-testid="csd-search"><label>Поиск товара / модели' +
          '<input type="search" name="q" maxlength="120" value="' + e(s.q) + '" placeholder="Название или GUID"></label>' +
          '<button type="submit">Найти</button></form>';
        if (data.itemState !== "loaded") {
          html += '<p role="status">Товарная детализация за этот период не загружена. Месячный итог не заменён нулём.</p>';
        } else if (!data.items.length) {
          html += '<p role="status">Товарные строки не найдены. Проверьте поиск; отсутствие строк не означает нулевые продажи.</p>';
        } else {
          html += '<table class="csd-products"><thead><tr><th>Товар / модель</th><th>Количество</th><th>Продажи</th></tr></thead><tbody>';
          html += data.items.map(function (item) {
            return '<tr><td><strong>' + e(item.name || "Без наименования") + '</strong><small>' + e(item.modelGuid) +
              '</small></td><td data-label="Количество">' + e(number(item.quantityTotal, false)) +
              '</td><td data-label="Продажи">' + e(number(item.incomeTotal, true)) + '</td></tr>';
          }).join("");
          html += '</tbody></table>';
        }
        html += '<div class="csd-pages"><button type="button" data-csd-prev' + (Number(s.page) <= 1 ? " disabled" : "") +
          '>Назад</button><span>Страница ' + e(s.page) + '</span><button type="button" data-csd-next' +
          (!data.hasMore ? " disabled" : "") + '>Далее</button></div>';
      }
      if (options.entity === "legal") html += '<p><a href="' + e(finance.pathname + finance.search) +
        '">Расширенная сводка по категориям с финансовыми показателями</a></p>';
      host.innerHTML = html + "</div>";
      function update(patch) { Object.assign(s, patch); write(s); load(); }
      host.querySelector('[data-testid="csd-month"]').onchange = function (event) {
        var month = event.target.value;
        var overviewSelect = document.querySelector('[data-testid="v3-client-sales-month"]');
        update({ month: month, category: null, q: "", page: "1" });
        if (overviewSelect) { overviewSelect.value = month; overviewSelect.dispatchEvent(new Event("change", { bubbles: true })); }
      };
      host.querySelector('[data-testid="csd-legal"]').onchange = function (event) {
        update({ legal: event.target.value, category: null, q: "", page: "1" });
      };
      host.querySelectorAll("[data-csd-category]").forEach(function (button) {
        button.onclick = function () { update({ category: button.getAttribute("data-csd-category"), q: "", page: "1" }); };
      });
      var back = host.querySelector("[data-csd-back]");
      if (back) back.onclick = function () { update({ category: null, q: "", page: "1" }); };
      var search = host.querySelector('[data-testid="csd-search"]');
      if (search) search.onsubmit = function (event) {
        event.preventDefault(); update({ q: search.querySelector("input").value.trim(), page: "1" });
      };
      var prev = host.querySelector("[data-csd-prev]");
      var next = host.querySelector("[data-csd-next]");
      if (prev) prev.onclick = function () { update({ page: String(Math.max(1, Number(s.page) - 1)) }); };
      if (next) next.onclick = function () { update({ page: String(Number(s.page) + 1) }); };
    }
    return { load: load };
  }
  window.ClientSalesDrilldown = { mount: mount };
})();
