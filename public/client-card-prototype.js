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
  function render(client) {
    var manager = client.manager && client.manager.name;
    var holding = client.holding && client.holding.name;
    var meta = '<div class="pc-meta"><span class="pc-tag">Источник: 1С</span><span>Холдинг: ' +
      esc(holding || "Не указан") + '</span><span>Менеджер: ' + esc(manager || "Не указан") +
      '</span><span>Категория и структура: данные не переданы</span></div>';
    var stats = '<div class="pc-stats">' + [
      ["Отгрузки / план", "1С / планы"], ["Дистрибьюция", "Осмотры торговых точек"],
      ["Просрочка", "1С / взаиморасчёты"], ["Рекламации", "Разрешённая сводка Битрикс24"]
    ].map(function (x) {
      return '<div class="pc-stat"><div class="pc-label">' + x[0] +
        '</div><div class="pc-number">—</div><div class="pc-label">Не подключено · ' + x[1] + '</div></div>';
    }).join("") + '</div>';
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
        field("Торговые точки", "Структура торговых точек не передана") +
        field("Адрес из 1С", client.address && client.address.trim(), !!(client.address && client.address.trim())) +
        field("Телефоны", (client.phones || []).map(function (p) { return p.value; }).join("; "), !!(client.phones || []).length) +
        '<button type="button" class="pc-link" data-card-open="data">Все данные и контакты →</button></div>', "1С") +
      '</div></section>' +
      '<section id="pc-panel-data" role="tabpanel" aria-labelledby="pc-tab-data" hidden>' +
      '<div class="pc-grid pc-three">' +
      card("Холдинг и ответственность", '<div class="pc-pad">' +
        field("Клиент / категория", (client.name || "Не указан") + " · категория не передана", true) +
        field("Холдинг / юрлица", (holding || "Холдинг не указан") + " · юрлица не переданы", !!holding) +
        field("Ответственные", (manager || "Менеджер не указан") + " · региональный / РОП не переданы", !!manager) +
        field("ЛПР и рабочая почта", "") + field("Временно замещает", "") + '</div>', "1С / ЛК") +
      card("Магазин и доставка", '<div class="pc-pad">' +
        field("Торговая точка", "") + field("Место поставки", "") +
        field("Приёмка", "") + field("Контакт приёмки", "") +
        field("График / направление", "") +
        '<p class="pc-label">Адрес из обмена показан в контактах. Он не считается автоматически торговой точкой или местом доставки.</p></div>', "1С") +
      card("Расчёты и договор", '<div class="pc-pad">' +
        field("Плательщик / договор", "") + field("Вид оплаты", "") +
        field("Бухгалтерия", "") + field("Наценки / скидки", "Правила применения уточняются у 1С") +
        field("Бонусные условия", "") + '</div>', "1С") +
      '</div><div class="pc-grid pc-equal pc-space">' +
      card("Особенности работы", pending("Условия приёмки, порядок связи, договорённости и особенности работы ещё не переданы."), "1С") +
      card("Качество данных", '<div class="pc-pad"><span class="pc-tag">Частично подключено</span>' +
        '<p>Связи холдинга, юрлиц и торговых точек ожидаются из 1С. Неподтверждённые сведения не подставляются.</p></div>', "1С / ЛК") +
      '</div><div id="pc-data-existing" class="pc-grid pc-equal pc-space"></div></section>' +
      tabs.slice(2).map(function (t) {
        var sources = {work:"Битрикс24",showcase:"Осмотры и каталог 1С",orders:"1С",finance:"1С",documents:"Битрикс24",claims:"Разрешённая сводка Битрикс24",plan:"Планы / факт отгрузок 1С"};
        if (t[0] === "work") {
          return '<section id="pc-panel-work" role="tabpanel" aria-labelledby="pc-tab-work" hidden>' +
            card("Работа", '<div class="pc-pad" id="pc-bitrix24-work" data-bitrix24-root></div>', sources.work) +
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
    ["section-contacts", "section-source", "section-future-data", "section-tech"].forEach(function (id) {
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
    }
  }
  window.ClientCardPrototype = {mount:mount};
})();
