(function () {
  "use strict";
  var tabs = [
    ["overview", "Обзор"], ["data", "Данные"], ["work", "Работа"],
    ["showcase", "Витрина"], ["orders", "Заказы"], ["finance", "Финансы"],
    ["documents", "Документы"], ["claims", "Рекламации"], ["plan", "План"]
  ];
  var esc = function (value) { return window.ClientDetailSections.escapeHtml(value || ""); };
  function card(title, content, source) {
    return '<section class="pc-card"><div class="pc-cardhead"><h2>' + esc(title) +
      '</h2><span class="pc-source">' + esc(source) + '</span></div>' + content + '</section>';
  }
  function field(label, value, known) {
    return '<div class="pc-field"><div class="pc-label">' + esc(label) +
      '</div><div class="' + (known ? "pc-value" : "pc-unavailable") + '">' +
      esc(value || "Данные не переданы") + '</div></div>';
  }
  function pending(text) { return '<div class="pc-pad pc-unavailable">' + esc(text) + '</div>'; }

  function managerLabel(ref) {
    if (!ref) return "Данные не переданы";
    return ref.assignmentLabel || ref.displayName || "Данные не переданы";
  }

  function loadingDaysLabel(loading) {
    if (!loading || !loading.days) return "";
    var hasAnyDayKey = loading.days.some(function (d) { return d.value !== null; });
    var active = loading.days.filter(function (d) { return d.value === true; }).map(function (d) { return d.label; });
    var timePart = loading.loadingTime ? " · начало " + loading.loadingTime : "";
    if (!hasAnyDayKey && !loading.loadingTime) return "";
    if (!hasAnyDayKey && loading.loadingTime) return "Начало приёмки" + timePart;
    if (hasAnyDayKey && active.length === 0) return "Дни не отмечены" + timePart;
    if (active.length > 0) return "Приёмка: " + active.join(", ") + timePart;
    return timePart ? "Начало приёмки" + timePart : "";
  }

  function loadingFieldKnown(loading) {
    if (!loading) return false;
    if (loading.loadingTime) return true;
    if (!loading.days) return false;
    return loading.days.some(function (d) { return d.value !== null; }) ||
      loading.scheduleState === "all_false" ||
      loading.scheduleState === "has_selected" ||
      loading.scheduleState === "partial";
  }

  function renderOutletBlock(outlet, index) {
    return '<div class="pc-outlet" data-testid="pc-outlet-' + index + '">' +
      field("Идентификация", outlet.identityLabel, true) +
      field("Статус", outlet.closureStatusLabel, true) +
      field("Холдинг (из точки)", outlet.holdingName, !!outlet.holdingName) +
      field("Адрес магазина", outlet.addresses && outlet.addresses.storeAddress, !!(outlet.addresses && outlet.addresses.storeAddress)) +
      field("Адрес доставки", outlet.addresses && outlet.addresses.deliveryAddress, !!(outlet.addresses && outlet.addresses.deliveryAddress)) +
      field("Направление маршрута", outlet.addresses && outlet.addresses.routeDirection, !!(outlet.addresses && outlet.addresses.routeDirection)) +
      field("Приёмка", loadingDaysLabel(outlet.loading), loadingFieldKnown(outlet.loading)) +
      field("Склад", outlet.warehouseLabel, outlet.warehouse !== null && outlet.warehouse !== undefined) +
      field("Менеджер ТТ", managerLabel(outlet.managers && outlet.managers.manager), !!(outlet.managers && outlet.managers.manager)) +
      field("Региональный менеджер ТТ", managerLabel(outlet.managers && outlet.managers.regionalManager), !!(outlet.managers && outlet.managers.regionalManager && outlet.managers.regionalManager.assignmentState !== "unassigned")) +
      field("Менеджер по фурнитуре ТТ", managerLabel(outlet.managers && outlet.managers.hardwareManager), !!(outlet.managers && outlet.managers.hardwareManager && outlet.managers.hardwareManager.assignmentState !== "unassigned")) +
      field("РОП ТТ", managerLabel(outlet.managers && outlet.managers.headOfSales), !!(outlet.managers && outlet.managers.headOfSales && outlet.managers.headOfSales.assignmentState !== "unassigned")) +
      field("Телефон магазина", outlet.contacts && outlet.contacts.storePhone, !!(outlet.contacts && outlet.contacts.storePhone)) +
      field("Телефон бухгалтерии", outlet.contacts && outlet.contacts.accountantPhone, !!(outlet.contacts && outlet.contacts.accountantPhone)) +
      field("Email бухгалтерии", outlet.contacts && outlet.contacts.accountantEmail, !!(outlet.contacts && outlet.contacts.accountantEmail)) +
      '<p class="pc-label pc-unavailable">Запись дистрибуции недоступна без идентификатора торговой точки.</p>' +
      "</div>";
  }

  function outletTotalCount(ext, visibleCount) {
    if (!ext) return visibleCount;
    if (typeof ext.retailOutletsTotalCount === "number") return ext.retailOutletsTotalCount;
    return visibleCount;
  }

  function outletCountLabel(ext, visibleCount) {
    var total = outletTotalCount(ext, visibleCount);
    if (ext && ext.retailOutletsTruncated && total > visibleCount) {
      return visibleCount + " из " + total + " (показаны первые " + visibleCount + ")";
    }
    return String(total);
  }

  function renderShopCard(ext, outletCount) {
    if (ext && ext.retailOutletsAccess === "denied") {
      return field("Торговые точки", "Недоступны для вашей роли", true) +
        field("Место поставки", "") +
        field("Приёмка", "") +
        field("Контакт приёмки", "") +
        field("График / направление", "") +
        '<p class="pc-label">Адрес из обмена показан в контактах. Он не считается автоматически торговой точкой или местом доставки.</p>';
    }
    if (!ext || !ext.retailOutlets || outletCount === 0) {
      return field("Торговая точка", "") + field("Место поставки", "") +
        field("Приёмка", "") + field("Контакт приёмки", "") +
        field("График / направление", "") +
        '<p class="pc-label">Адрес из обмена показан в контактах. Он не считается автоматически торговой точкой или местом доставки.</p>';
    }
    if (outletCount === 1) {
      var outlet = ext.retailOutlets[0];
      return field("Торговая точка", outlet.identityLabel, true) +
        field("Место поставки", outlet.addresses.deliveryAddress, !!outlet.addresses.deliveryAddress) +
        field("Приёмка", loadingDaysLabel(outlet.loading), loadingFieldKnown(outlet.loading)) +
        field("Контакт приёмки", outlet.contacts.storePhone, !!outlet.contacts.storePhone) +
        field("График / направление", outlet.addresses.routeDirection, !!outlet.addresses.routeDirection) +
        field("Склад", outlet.warehouseLabel, outlet.warehouse !== null);
    }
    return field("Торговые точки", outletCountLabel(ext, outletCount) + " точек в текущем снимке. Подробности — в списке ниже.", true) +
      field("Место поставки", "Выберите торговую точку в списке ниже", true) +
      field("Приёмка", "Зависит от выбранной торговой точки", true) +
      field("Контакт приёмки", "") +
      field("График / направление", "") +
      '<p class="pc-label">Первая точка в массиве не считается основной автоматически.</p>';
  }

  function render(client) {
    var ext = client.extended || null;
    var manager = client.manager && client.manager.name;
    var holding = client.holding && client.holding.name;
    var outletAccessDenied = ext && ext.retailOutletsAccess === "denied";
    var outletCount = ext && ext.retailOutlets ? ext.retailOutlets.length : 0;
    var outletTotal = outletTotalCount(ext, outletCount);
    var structureLabel = outletAccessDenied
      ? "данные торговых точек недоступны"
      : outletTotal > 0
        ? "Торговые точки: " + outletCountLabel(ext, outletCount) + " (без постоянного GUID)"
        : "данные не переданы";
    var meta = '<div class="pc-meta"><span class="pc-tag">Источник: 1С</span><span>Холдинг: ' +
      esc(holding || "Не указан") + '</span><span>Менеджер: ' + esc(manager || "Не указан") +
      '</span><span>Структура: ' + esc(structureLabel) + '</span></div>';

    var clientManagersText = manager || "Менеджер не указан";
    if (ext && ext.managers) {
      var parts = [clientManagersText];
      if (ext.managers.regionalManager && ext.managers.regionalManager.assignmentState !== "unassigned") {
        parts.push("региональный: " + managerLabel(ext.managers.regionalManager));
      }
      if (ext.managers.headOfSales && ext.managers.headOfSales.assignmentState !== "unassigned") {
        parts.push("РОП: " + managerLabel(ext.managers.headOfSales));
      }
      if (ext.managers.hardwareManager && ext.managers.hardwareManager.assignmentState !== "unassigned") {
        parts.push("фурнитура: " + managerLabel(ext.managers.hardwareManager));
      }
      clientManagersText = parts.join(" · ");
    }

    var holdingCard = ext && ext.holdingCardLabel ? ext.holdingCardLabel + " · " : "";
    var overviewOutlets = outletAccessDenied
      ? "Торговые точки недоступны для вашей роли"
      : outletTotal > 0
        ? outletCountLabel(ext, outletCount) + " точек из выгрузки 1С (идентификатор не передан)"
        : "Структура торговых точек не передана";

    var stats = '<div class="pc-stats">' + [
      ["Отгрузки / план", "1С / планы"], ["Дистрибьюция", "Осмотры торговых точек"],
      ["Просрочка", "1С / взаиморасчёты"], ["Рекламации", "Разрешённая сводка Битрикс24"]
    ].map(function (x) {
      var numberAttrs = x[0] === "Рекламации" ? ' data-stat-claims' : '';
      return '<div class="pc-stat"><div class="pc-label">' + x[0] +
        '</div><div class="pc-number"' + numberAttrs + '>—</div><div class="pc-label">' +
        (x[0] === "Рекламации" ? "Разрешённая сводка · " : "Не подключено · ") + x[1] + '</div></div>';
    }).join("") + '</div>';

    var outletCards = "";
    if (ext && ext.retailOutlets && ext.retailOutlets.length > 0) {
      outletCards = ext.retailOutlets.map(function (outlet, index) {
        return card("Торговая точка " + (index + 1), '<div class="pc-pad">' + renderOutletBlock(outlet, index) + "</div>", "1С");
      }).join("");
      if (ext.retailOutletsTruncated) {
        outletCards += '<p class="pc-pad pc-label pc-unavailable">Показаны первые ' + ext.retailOutlets.length +
          " из " + outletTotalCount(ext, ext.retailOutlets.length) + " торговых точек.</p>";
      }
    }

    var shopCard = renderShopCard(ext, outletCount);

    var freshnessNote = ext && ext.freshnessLabel
      ? '<p class="pc-label">' + esc(ext.freshnessLabel) + '</p>'
      : "";
    var dataQuality = ext
      ? '<div class="pc-pad"><span class="pc-tag">' + esc(ext.dataQualityLabel || "Частично подключено") + '</span>' +
        freshnessNote +
        '<p>Торговые точки доступны только для просмотра. ЛПР и персональные бонусы не публикуются без отдельного разрешения.</p></div>'
      : '<div class="pc-pad"><span class="pc-tag">Частично подключено</span>' +
        '<p>Связи холдинга, юрлиц и торговых точек ожидаются из 1С. Неподтверждённые сведения не подставляются.</p></div>';

    return '<div class="pc-tabs" role="tablist" aria-label="Разделы карточки">' +
      tabs.map(function (t, i) {
        return '<button type="button" role="tab" id="pc-tab-' + t[0] +
          '" data-card-tab="' + t[0] + '" aria-controls="pc-panel-' + t[0] +
          '" aria-selected="' + (!i) + '" tabindex="' + (i ? -1 : 0) + '">' + t[1] + '</button>';
      }).join("") + '</div>' +
      '<section id="pc-panel-overview" role="tabpanel" aria-labelledby="pc-tab-overview">' +
      meta + '<div class="pc-notice"><strong>Карточка подключается поэтапно</strong>' +
      '<p>Контакты и менеджер доступны из 1С. Отсутствие показателя не означает нулевое значение.</p></div>' +
      stats + '<div class="pc-grid pc-two">' +
      card("Следующие действия", '<div class="pc-pad" id="pc-bitrix24-overview" aria-live="polite"></div>', "Битрикс24") +
      card("Точки и контакты", '<div class="pc-pad">' +
        field("Торговые точки", overviewOutlets, !outletAccessDenied && outletCount > 0) +
        field("Адрес из 1С", client.address && client.address.trim(), !!(client.address && client.address.trim())) +
        field("Телефоны", (client.phones || []).map(function (p) { return p.value; }).join("; "), !!(client.phones || []).length) +
        '<button type="button" class="pc-link" data-card-open="data">Все данные и контакты →</button></div>', "1С") +
      '</div></section>' +
      '<section id="pc-panel-data" role="tabpanel" aria-labelledby="pc-tab-data" hidden>' +
      '<div class="pc-grid pc-three">' +
      card("Холдинг и ответственность", '<div class="pc-pad">' +
        field("Клиент / категория", (client.name || "Не указан") + " · категория не передана", true) +
        field("Холдинг / юрлица", holdingCard + (holding || "Холдинг не указан") + " · юрлица не переданы", !!holding || !!ext) +
        field("Ответственные (клиент)", clientManagersText, !!manager || !!ext) +
        field("ЛПР и рабочая почта", ext && ext.sensitiveFieldsWithheld ? "Не публикуются без отдельного разрешения" : "") +
        field("Временно замещает", "") + '</div>', "1С / ЛК") +
      card("Магазин и доставка", '<div class="pc-pad">' + shopCard + '</div>', "1С") +
      card("Расчёты и договор", '<div class="pc-pad">' +
        field("Плательщик / договор", "") + field("Вид оплаты", "") +
        field("Бухгалтерия", "") + field("Наценки / скидки", "Правила применения уточняются у 1С") +
        field("Бонусные условия", ext && ext.sensitiveFieldsWithheld ? "Персональные бонусы не публикуются" : "") +
        '</div>', "1С") +
      '</div>' +
      (outletCards ? '<div class="pc-grid pc-equal pc-space">' + outletCards + "</div>" : "") +
      '<div class="pc-grid pc-equal pc-space">' +
      card("Особенности работы", pending("Условия приёмки, порядок связи, договорённости и особенности работы ещё не переданы."), "1С") +
      card("Качество данных", dataQuality, "1С / ЛК") +
      '</div><div id="pc-data-existing" class="pc-grid pc-equal pc-space"></div></section>' +
      tabs.slice(2).map(function (t) {
        var sources = {work:"Битрикс24",showcase:"Осмотры и каталог 1С",orders:"1С",finance:"1С",documents:"Битрикс24",claims:"Разрешённая сводка Битрикс24",plan:"Планы / факт отгрузок 1С"};
        if (t[0] === "work") {
          return '<section id="pc-panel-work" role="tabpanel" aria-labelledby="pc-tab-work" hidden>' +
            card("Работа", '<div class="pc-pad" id="pc-bitrix24-work" data-bitrix24-root></div>', sources.work) +
            '</section>';
        }
        if (t[0] === "claims") {
          return '<section id="pc-panel-claims" role="tabpanel" aria-labelledby="pc-tab-claims" hidden>' +
            card("Рекламации", '<div class="pc-pad" id="pc-bitrix24-claims" data-bitrix24-claims-root aria-live="polite"></div>', sources.claims) +
            '</section>';
        }
        if (t[0] === "showcase") {
          return '<section id="pc-panel-showcase" role="tabpanel" aria-labelledby="pc-tab-showcase" hidden>' +
            card("Каталог для дистрибуции", '<div class="pc-pad" id="pc-catalog-showcase" data-catalog-root aria-live="polite"></div>', sources.showcase) +
            '</section>';
        }
        return '<section id="pc-panel-' + t[0] + '" role="tabpanel" aria-labelledby="pc-tab-' + t[0] + '" hidden>' +
          card(t[1], pending("Раздел ещё не подключён. После интеграции здесь появятся данные по этому клиенту; сейчас их наличие и количество неизвестны."), sources[t[0]]) +
          '</section>';
      }).join("");
  }

  function mount(root, client) {
    var existing = root.querySelector("#client-detail-sections");
    var wrapper = document.createElement("div");
    wrapper.className = "pc-workspace";
    wrapper.innerHTML = render(client);
    root.insertBefore(wrapper, existing);
    var target = wrapper.querySelector("#pc-data-existing");
    var futureSection = existing.querySelector('[data-testid="section-future-data"]');
    if (!client.extended && futureSection) {
      target.appendChild(futureSection);
    }
    ["section-contacts", "section-source", "section-tech"].forEach(function (id) {
      var section = existing.querySelector('[data-testid="' + id + '"]');
      if (section) target.appendChild(section);
    });
    existing.remove();
    var header = root.querySelector(".client-detail-header");
    var heading = document.createElement("h1");
    heading.id = "client-name";
    heading.textContent = client.name || "Клиент";
    header.appendChild(heading);
    var subtitle = document.createElement("p");
    subtitle.className = "pc-subtitle";
    subtitle.textContent = "Обзор клиента · единая картина для команды";
    header.appendChild(subtitle);
    function select(id, focus) {
      tabs.forEach(function (t) {
        var btn = wrapper.querySelector("#pc-tab-" + t[0]);
        var selected = id === t[0];
        btn.setAttribute("aria-selected", String(selected));
        btn.tabIndex = selected ? 0 : -1;
        wrapper.querySelector("#pc-panel-" + t[0]).hidden = !selected;
        if (selected && focus) { btn.focus(); btn.scrollIntoView({block:"nearest",inline:"nearest"}); }
      });
      heading.textContent = id === "data" ? "Данные и условия клиента" : (client.name || "Клиент");
      subtitle.textContent = id === "data" ? (client.name || "Клиент") : "Обзор клиента · единая картина для команды";
    }
    wrapper.querySelectorAll("[data-card-tab]").forEach(function (btn, index) {
      btn.addEventListener("click", function () { select(btn.dataset.cardTab, false); });
      btn.addEventListener("keydown", function (event) {
        var next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); select(tabs[next][0], true); }
      });
    });
    wrapper.querySelectorAll("[data-card-open]").forEach(function (btn) {
      btn.addEventListener("click", function () { select(btn.dataset.cardOpen, true); });
    });
    if (window.ClientBitrix24 && client.guid) {
      window.ClientBitrix24.mountWorkTab(wrapper, client.guid);
      window.ClientBitrix24.mountClaimsTab(wrapper, client.guid);
    }
    var catalogMounted = false;
    function mountCatalogIfNeeded() {
      if (catalogMounted || !window.ClientCatalog || !client.guid) return;
      catalogMounted = true;
      window.ClientCatalog.mountShowcaseTab(wrapper, client.guid);
    }
    var originalSelect = select;
    select = function (id, focus) {
      originalSelect(id, focus);
      if (id === "showcase") mountCatalogIfNeeded();
    };
  }
  var exported = { mount: mount, render: render, managerLabel: managerLabel, loadingDaysLabel: loadingDaysLabel };
  if (typeof window !== "undefined") {
    window.ClientCardPrototype = exported;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})();
