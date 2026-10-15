(function (root) {
  "use strict";

  var TABS = [
    ["overview", "Обзор", true],
    ["data", "Данные", true],
    ["work", "Работа", false],
    ["showcase", "Витрина", false],
    ["orders", "Заказы", false],
    ["finance", "Финансы", false],
    ["documents", "Документы", false],
    ["claims", "Рекламации", false],
    ["plan", "План", false],
  ];

  var UNAVAILABLE_SECTION_COPY = {
    work: "Задачи и работа с клиентом доступны в полной карточке с подключённым Битрикс24.",
    showcase: "Витрина и каталог не подключены к v3-карточке.",
    orders: "Заказы не подключены к v3-карточке.",
    finance: "Финансовые показатели не подключены к v3-карточке.",
    documents: "Документы не подключены к v3-карточке.",
    claims: "Рекламации не подключены к v3-карточке.",
    plan: "План продаж не подключён к v3-карточке.",
  };

  function esc(shell, value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    return shell.escapeHtml(String(value));
  }

  function emptyNoData() {
    return '<span class="pc-unavailable">Нет данных</span>';
  }

  function emptyFrom1C() {
    return '<span class="pc-unavailable">Не передано из 1С</span>';
  }

  function boolLabel(value) {
    if (value === true) return "Да";
    if (value === false) return "Нет";
    return emptyNoData();
  }

  function card(title, content, source) {
    return (
      '<section class="pc-card"><div class="pc-cardhead"><h2>' +
      title +
      '</h2><span class="pc-source">' +
      source +
      "</span></div>" +
      content +
      "</section>"
    );
  }

  function field(label, valueHtml, known) {
    return (
      '<div class="pc-field"><div class="pc-label">' +
      label +
      '</div><div class="' +
      (known ? "pc-value" : "pc-unavailable") +
      '">' +
      (valueHtml || emptyFrom1C()) +
      "</div></div>"
    );
  }

  function entityKindLabel(entityType) {
    if (entityType === "holding") return "Холдинг";
    if (entityType === "legal") return "Юрлицо";
    return "Торговая точка";
  }

  function normalizeManagers(managers) {
    if (!managers || typeof managers !== "object") {
      return null;
    }
    return {
      nameManager: managers.nameManager || managers.name_manager || "",
      nameRegionalManager: managers.nameRegionalManager || managers.name_regional_manager || "",
      nameHardwareManager: managers.nameHardwareManager || managers.name_hardware_manager || "",
      nameHeadOfSales: managers.nameHeadOfSales || managers.name_head_of_the_sales_department || "",
    };
  }

  function formatTypeCategory(shell, tc) {
    if (!tc || typeof tc !== "object") {
      return { html: emptyFrom1C(), known: false };
    }
    var type = tc.nameType || tc.name_type || "";
    var cat = tc.nameCategory || tc.name_category || "";
    if (type && cat) {
      return { html: esc(shell, type + " / " + cat), known: true };
    }
    if (type || cat) {
      return { html: esc(shell, type || cat), known: true };
    }
    if (tc.guidType || tc.guid_type || tc.guidCategory || tc.guid_category) {
      return { html: emptyFrom1C(), known: false };
    }
    return { html: emptyFrom1C(), known: false };
  }

  function formatTelephones(shell, tel) {
    if (!Array.isArray(tel) || !tel.length) {
      return { html: emptyNoData(), known: false };
    }
    return { html: tel.map(function (t) { return esc(shell, t); }).join(", "), known: true };
  }

  function formatMarkups(shell, markups) {
    if (!Array.isArray(markups) || !markups.length) {
      return { html: emptyNoData(), known: false };
    }
    var text = markups
      .map(function (m) {
        if (!m || typeof m !== "object") return "";
        return esc(shell, (m.name || "—") + (m.percentage != null ? " (" + m.percentage + "%)" : ""));
      })
      .filter(Boolean)
      .join("; ");
    return { html: text || emptyNoData(), known: Boolean(text) };
  }

  function formatOtherFields(shell, other) {
    if (!other || typeof other !== "object") {
      return { html: emptyFrom1C(), known: false };
    }
    var keys = Object.keys(other);
    if (!keys.length) {
      return { html: emptyNoData(), known: false };
    }
    return {
      html: keys
        .map(function (k) {
          return esc(shell, k + ": " + other[k]);
        })
        .join("<br/>"),
      known: true,
    };
  }

  function formatLoading(shell, loading) {
    if (!loading || typeof loading !== "object") {
      return { html: emptyFrom1C(), known: false };
    }
    var days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    var keys = [
      ["loadingOnMonday", "loading_on_monday"],
      ["loadingOnTuesday", "loading_on_tuesday"],
      ["loadingOnWednesday", "loading_on_wednesday"],
      ["loadingOnThursday", "loading_on_thursday"],
      ["loadingOnFriday", "loading_on_friday"],
      ["loadingOnSaturday", "loading_on_saturday"],
      ["loadingOnSunday", "loading_on_sunday"],
    ];
    var parts = [];
    for (var i = 0; i < keys.length; i += 1) {
      if (loading[keys[i][0]] === true || loading[keys[i][1]] === true) {
        parts.push(days[i]);
      }
    }
    var time = loading.loadingTime || loading.loading_time || "";
    if (!parts.length && !time) {
      return { html: emptyNoData(), known: false };
    }
    if (time && !parts.length) {
      return { html: esc(shell, time), known: true };
    }
    if (time) {
      return { html: esc(shell, parts.join(", ") + " · " + time), known: true };
    }
    return { html: esc(shell, parts.join(", ")), known: parts.length > 0 };
  }

  function formatContactsFields(shell, contacts) {
    if (!contacts || typeof contacts !== "object") {
      return field("Контакты", emptyFrom1C(), false);
    }
    var rows = [];
    var storePhone = contacts.store_phone || contacts.storePhone;
    var accountantPhone = contacts.accountant_phone || contacts.accountantPhone;
    var accountantEmail = contacts.accountant_email || contacts.accountantEmail;
    if (storePhone) rows.push(field("Телефон магазина", esc(shell, storePhone), true));
    if (accountantPhone) rows.push(field("Телефон бухгалтерии", esc(shell, accountantPhone), true));
    if (accountantEmail) rows.push(field("Email бухгалтерии", esc(shell, accountantEmail), true));
    if (!rows.length) {
      return field("Контакты", emptyNoData(), false);
    }
    return rows.join("");
  }

  function formatLprBlock(shell, lpr) {
    if (!lpr || typeof lpr !== "object") {
      return field("ЛПР", emptyFrom1C(), false);
    }
    var rows = [];
    if (lpr.name) rows.push(field("ФИО", esc(shell, lpr.name), true));
    if (lpr.post) rows.push(field("Должность", esc(shell, lpr.post), true));
    if (lpr.phone) rows.push(field("Телефон", esc(shell, lpr.phone), true));
    if (lpr.email) rows.push(field("Email", esc(shell, lpr.email), true));
    if (lpr.date_of_birth || lpr.dateOfBirth) {
      rows.push(field("Дата рождения", esc(shell, lpr.date_of_birth || lpr.dateOfBirth), true));
    }
    if (lpr.bonus) rows.push(field("Бонус", esc(shell, lpr.bonus), true));
    if (lpr.conditions_bonus || lpr.conditionsBonus) {
      rows.push(field("Условия бонуса", esc(shell, lpr.conditions_bonus || lpr.conditionsBonus), true));
    }
    if (!rows.length) {
      return field("ЛПР", emptyNoData(), false);
    }
    return rows.join("");
  }

  function formatClubFields(shell, add) {
    if (!add || typeof add !== "object") {
      return field("Tandoor Club", emptyFrom1C(), false);
    }
    var status = add.status_tandoor_club ?? add.statusTandoorClub;
    var bonus = add.bonus_tandoor_club ?? add.bonusTandoorClub;
    if ((status == null || status === "") && (bonus == null || bonus === "")) {
      return field("Tandoor Club", emptyNoData(), false);
    }
    var parts = [];
    if (status != null && status !== "") parts.push("Статус: " + status);
    if (bonus != null && bonus !== "") parts.push("Бонус: " + bonus);
    return field("Tandoor Club", esc(shell, parts.join(" · ")), true);
  }

  function managersFields(shell, managersRaw) {
    var managers = normalizeManagers(managersRaw);
    if (!managers) {
      return (
        field("Менеджер", emptyFrom1C(), false) +
        field("Региональный менеджер", emptyFrom1C(), false) +
        field("Менеджер фурнитуры", emptyFrom1C(), false) +
        field("РОП", emptyFrom1C(), false)
      );
    }
    function mgr(label, value) {
      return field(label, value ? esc(shell, value) : emptyNoData(), Boolean(value));
    }
    return (
      mgr("Менеджер", managers.nameManager) +
      mgr("Региональный менеджер", managers.nameRegionalManager) +
      mgr("Менеджер фурнитуры", managers.nameHardwareManager) +
      mgr("РОП", managers.nameHeadOfSales)
    );
  }

  function formatHoldingLink(shell, holdingLink) {
    if (!holdingLink || !holdingLink.guid) {
      return { html: emptyNoData(), known: false };
    }
    var ret = encodeURIComponent(root.location.pathname + root.location.search);
    return {
      html:
        '<a class="clients-link" href="/clients/' +
        encodeURIComponent(holdingLink.guid) +
        "?v3Entity=holding&return=" +
        ret +
        '">' +
        esc(shell, holdingLink.name || "Холдинг") +
        "</a>",
      known: true,
    };
  }

  function resolveTitle(entityType, ent) {
    if (entityType === "legal") {
      return ent.name_client || ent.name || "Юрлицо";
    }
    if (entityType === "holding") {
      return ent.name || "Холдинг";
    }
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    return addr.store_address || addr.storeAddress || ent.name || "Торговая точка";
  }

  function freshnessMeta(shell, ent) {
    if (!ent.last_imported_at) {
      return "";
    }
    return (
      '<div class="pc-meta"><span>Обновлено из 1С: ' +
      esc(shell, ent.last_imported_at) +
      "</span></div>"
    );
  }

  function overviewStats() {
    var labels = ["Отгрузки / план", "Дистрибуция МК", "Просрочка", "Рекламации"];
    return (
      '<div class="pc-stats v3-detail-stats" aria-label="Показатели">' +
      labels
        .map(function (label) {
          return (
            '<div class="pc-stat"><div class="pc-label">' +
            label +
            '</div><div class="pc-unavailable v3-detail-stat__value">Не подключено</div></div>'
          );
        })
        .join("") +
      "</div>"
    );
  }

  function overviewNotice() {
    return (
      '<div class="pc-notice"><strong>Карточка v3 из обмена 1С</strong>' +
      "<p>Показаны только подтверждённые поля текущего обмена. Отсутствие показателя не означает нулевое значение.</p></div>"
    );
  }

  function renderRoleContextBlock(shell, session) {
    session = session || {};
    var name = session.displayName || "—";
    var roleLabel = session.roleLabel || "—";
    var scope = session.scopeLabel || "—";
    var initials = name
      .split(/\s+/)
      .map(function (part) {
        return part.charAt(0);
      })
      .join("")
      .slice(0, 2)
      .toUpperCase();
    if (!initials) {
      initials = "?";
    }
    return (
      '<div class="v3-role-context" data-testid="v3-role-context">' +
      '<div class="v3-role-context__row">' +
      '<div class="v3-role-context__main">' +
      '<span class="v3-role-context__avatar" aria-hidden="true">' +
      esc(shell, initials) +
      "</span>" +
      '<div><div class="v3-role-context__name">' +
      esc(shell, name) +
      '</div><div class="pc-label">' +
      esc(shell, roleLabel) +
      "</div></div></div>" +
      '<div class="v3-role-context__scope"><div class="pc-label">Область видимости</div>' +
      '<div class="pc-value">' +
      esc(shell, scope) +
      "</div></div></div>" +
      '<div class="v3-role-focus"><div class="pc-label">В фокусе роли</div>' +
      '<div class="v3-role-focus__actions">' +
      '<button type="button" class="v3-focus-link" disabled title="Раздел не подключён в v3-карточке">Работа по клиенту →</button>' +
      '<button type="button" class="v3-focus-link" disabled title="Раздел не подключён в v3-карточке">Планы и результат →</button>' +
      '<button type="button" class="v3-focus-link" data-card-open="data">Назначения и данные →</button>' +
      "</div></div></div>"
    );
  }

  function entityMetaLine(shell, entityType, ent, holdingLink, typeCat) {
    var parts = [];
    parts.push(esc(shell, entityKindLabel(entityType)));
    if (typeCat.known) {
      parts.push(typeCat.html);
    }
    if (holdingLink && holdingLink.name) {
      parts.push(esc(shell, holdingLink.name));
    }
    var managers = normalizeManagers(ent.managers);
    if (managers && managers.nameManager) {
      parts.push("Менеджер: " + esc(shell, managers.nameManager));
    }
    if (managers && managers.nameRegionalManager) {
      parts.push("Региональный: " + esc(shell, managers.nameRegionalManager));
    }
    if (!parts.length) {
      return "";
    }
    return '<div class="pc-meta v3-entity-meta">' + parts.join(" · ") + "</div>";
  }

  function renderPointsAndContactsCard(shell, entityType, ent, holdingLink, typeCat) {
    var holding = formatHoldingLink(shell, holdingLink);
    var phones = formatTelephones(shell, ent.telephone);
    var body = '<div class="pc-pad">';
    body += field("Тип и категория", typeCat.html, typeCat.known);
    if (entityType === "legal") {
      body += field("Адрес", ent.address ? esc(shell, ent.address) : emptyNoData(), Boolean(ent.address));
      body += field("Телефоны", phones.html, phones.known);
      body += field("Холдинг", holding.html, holding.known);
      body += field("Торговые точки", emptyFrom1C(), false);
    } else if (entityType === "retail") {
      var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
      body += field(
        "Адрес магазина",
        addr.store_address || addr.storeAddress ? esc(shell, addr.store_address || addr.storeAddress) : emptyNoData(),
        Boolean(addr.store_address || addr.storeAddress),
      );
      body += field(
        "Адрес доставки",
        addr.delivery_address || addr.deliveryAddress
          ? esc(shell, addr.delivery_address || addr.deliveryAddress)
          : emptyNoData(),
        Boolean(addr.delivery_address || addr.deliveryAddress),
      );
      body += field("Холдинг", holding.html, holding.known);
      body += formatContactsFields(shell, ent.contact_information);
    } else {
      body += field("Название", ent.name ? esc(shell, ent.name) : emptyNoData(), Boolean(ent.name));
      body += field("Розничная сеть", boolLabel(ent.retail_chain), ent.retail_chain != null);
      body += field("Группа холдинга", boolLabel(ent.holding_group), ent.holding_group != null);
    }
    body += '<button type="button" class="pc-link" data-card-open="data">Все данные и паспорт →</button></div>';
    return card("Точки и контакты", body, "1С / осмотр");
  }

  function renderDataFooter(shell) {
    return (
      '<div class="pc-grid pc-equal v3-data-footer">' +
      card(
        "Особенности работы",
        '<div class="pc-pad"><span class="pc-unavailable">Условия и особенности работы не переданы в текущем обмене v3.</span></div>',
        "1С",
      ) +
      card(
        "Качество данных",
        '<div class="pc-pad"><span class="pc-tag">Частично из обмена v3</span>' +
          '<p class="pc-unavailable">Полная оценка качества карточки недоступна без модулей проверки.</p></div>',
        "ЛК",
      ) +
      "</div>"
    );
  }

  function renderOverviewPanel(shell, entityType, ent, holdingLink, typeCat) {
    return (
      entityMetaLine(shell, entityType, ent, holdingLink, typeCat) +
      freshnessMeta(shell, ent) +
      overviewNotice() +
      overviewStats() +
      '<div class="pc-grid pc-two">' +
      card(
        "Следующие действия",
        '<div class="pc-pad"><span class="pc-unavailable">Битрикс24 не подключён к v3-карточке.</span></div>',
        "Битрикс24",
      ) +
      renderPointsAndContactsCard(shell, entityType, ent, holdingLink, typeCat) +
      "</div>"
    );
  }

  function renderDataLegal(shell, ent, holdingLink, typeCat) {
    var holding = formatHoldingLink(shell, holdingLink);
    var phones = formatTelephones(shell, ent.telephone);
    var other = formatOtherFields(shell, ent.other_fields);
    var markups = formatMarkups(shell, ent.markups);
    var discountKnown = ent.discount != null && ent.discount !== "";
    var discountAmountKnown = ent.discount_amount != null && ent.discount_amount !== "";
    return (
      '<div class="pc-grid pc-three">' +
      card(
        "Холдинг и ответственность",
        '<div class="pc-pad">' +
          field("Клиент / категория", typeCat.html, typeCat.known) +
          field("Название", esc(shell, ent.name_client || ent.name), Boolean(ent.name_client || ent.name)) +
          field("Холдинг", holding.html, holding.known) +
          field("Реквизиты", other.html, other.known) +
          managersFields(shell, ent.managers) +
          "</div>",
        "1С / ЛК",
      ) +
      card(
        "Магазин и доставка",
        '<div class="pc-pad">' +
          field("Адрес юрлица", ent.address ? esc(shell, ent.address) : emptyNoData(), Boolean(ent.address)) +
          field("Телефоны", phones.html, phones.known) +
          field("Торговая точка", emptyFrom1C(), false) +
          field("Место доставки", emptyFrom1C(), false) +
          field("Приёмка", emptyFrom1C(), false) +
          "</div>",
        "1С",
      ) +
      card(
        "Расчёты и договор",
        '<div class="pc-pad">' +
          field("Скидка", discountKnown ? esc(shell, ent.discount) : emptyNoData(), discountKnown) +
          field(
            "Сумма скидки",
            discountAmountKnown ? esc(shell, ent.discount_amount) : emptyNoData(),
            discountAmountKnown,
          ) +
          field("Наценки", markups.html, markups.known) +
          field("Бонусные условия", emptyFrom1C(), false) +
          "</div>",
        "1С",
      ) +
      "</div>" +
      renderDataFooter(shell)
    );
  }

  function renderDataRetail(shell, ent, holdingLink, typeCat) {
    var holding = formatHoldingLink(shell, holdingLink);
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    var route = addr.direction_of_the_route || addr.directionOfTheRoute;
    var loading = formatLoading(shell, ent.information_loading);
    return (
      '<div class="pc-grid pc-three">' +
      card(
        "Холдинг и ответственность",
        '<div class="pc-pad">' +
          field("Тип и категория", typeCat.html, typeCat.known) +
          field("Холдинг", holding.html, holding.known) +
          managersFields(shell, ent.managers) +
          "</div>",
        "1С",
      ) +
      card(
        "Магазин и доставка",
        '<div class="pc-pad">' +
          field(
            "Адрес магазина",
            addr.store_address || addr.storeAddress ? esc(shell, addr.store_address || addr.storeAddress) : emptyNoData(),
            Boolean(addr.store_address || addr.storeAddress),
          ) +
          field(
            "Адрес доставки",
            addr.delivery_address || addr.deliveryAddress
              ? esc(shell, addr.delivery_address || addr.deliveryAddress)
              : emptyNoData(),
            Boolean(addr.delivery_address || addr.deliveryAddress),
          ) +
          field("Маршрут", route ? esc(shell, route) : emptyNoData(), Boolean(route)) +
          field("Склад", boolLabel(ent.warehouse), ent.warehouse != null) +
          field("Закрыта", boolLabel(ent.closed), ent.closed != null) +
          field("Приёмка", loading.html, loading.known) +
          formatContactsFields(shell, ent.contact_information) +
          "</div>",
        "1С",
      ) +
      card(
        "Расчёты и договор",
        '<div class="pc-pad">' +
          formatLprBlock(shell, ent.lpr_information) +
          formatClubFields(shell, ent.additional_information) +
          field("Наценки / скидки", emptyFrom1C(), false) +
          "</div>",
        "1С",
      ) +
      "</div>" +
      renderDataFooter(shell)
    );
  }

  function renderDataHolding(shell, ent, typeCat) {
    return (
      '<div class="pc-grid pc-three">' +
      card(
        "Холдинг и ответственность",
        '<div class="pc-pad">' +
          field("Название", esc(shell, ent.name), Boolean(ent.name)) +
          field("Тип и категория", typeCat.html, typeCat.known) +
          field("Розничная сеть", boolLabel(ent.retail_chain), ent.retail_chain != null) +
          field("Группа холдинга", boolLabel(ent.holding_group), ent.holding_group != null) +
          managersFields(shell, ent.managers) +
          "</div>",
        "1С / ЛК",
      ) +
      card(
        "Магазин и доставка",
        '<div class="pc-pad">' +
          field("Состав холдинга", "См. блок ниже", true) +
          field("Торговая точка", emptyFrom1C(), false) +
          field("Место доставки", emptyFrom1C(), false) +
          "</div>",
        "1С",
      ) +
      card(
        "Расчёты и договор",
        '<div class="pc-pad">' +
          field("Договор и оплата", emptyFrom1C(), false) +
          field("Наценки / скидки", emptyFrom1C(), false) +
          "</div>",
        "1С",
      ) +
      "</div>" +
      card(
        "Состав холдинга",
        '<div class="pc-pad" id="v3-composition" data-holding-guid="' +
          esc(shell, ent.guid || "") +
          '">Загрузка состава…</div>',
        "1С",
      ) +
      renderDataFooter(shell)
    );
  }

  function renderUnavailablePanel(id, label) {
    return (
      '<section id="pc-panel-' +
      id +
      '" class="v3-detail-panel v3-detail-panel--unavailable" role="tabpanel" aria-labelledby="pc-tab-' +
      id +
      '" hidden>' +
      '<div class="pc-notice"><strong>' +
      label +
      "</strong>" +
      '<p class="pc-unavailable">' +
      (UNAVAILABLE_SECTION_COPY[id] || "Раздел недоступен в v3-карточке.") +
      "</p></div></section>"
    );
  }

  function renderTabsMarkup() {
    return (
      '<div class="pc-tabs" role="tablist" aria-label="Разделы карточки">' +
      TABS.map(function (t, i) {
        return (
          '<button type="button" role="tab" id="pc-tab-' +
          t[0] +
          '" data-card-tab="' +
          t[0] +
          '" aria-controls="pc-panel-' +
          t[0] +
          '" aria-selected="' +
          (!i) +
          '" tabindex="' +
          (i ? -1 : 0) +
          '">' +
          t[1] +
          "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function renderCard(shell, entityType, ent, holdingLink, options) {
    options = options || {};
    var typeCat = formatTypeCategory(shell, ent.type_category);
    var title = resolveTitle(entityType, ent);
    var overviewHtml = renderOverviewPanel(shell, entityType, ent, holdingLink, typeCat);
    var dataHtml =
      entityType === "holding"
        ? renderDataHolding(shell, ent, typeCat)
        : entityType === "legal"
          ? renderDataLegal(shell, ent, holdingLink, typeCat)
          : renderDataRetail(shell, ent, holdingLink, typeCat);

    var panels =
      '<section id="pc-panel-overview" class="v3-detail-panel" role="tabpanel" aria-labelledby="pc-tab-overview">' +
      overviewHtml +
      "</section>" +
      '<section id="pc-panel-data" class="v3-detail-panel" role="tabpanel" aria-labelledby="pc-tab-data" hidden>' +
      dataHtml +
      "</section>";

    TABS.forEach(function (t) {
      if (t[2]) return;
      panels += renderUnavailablePanel(t[0], t[1]);
    });

    return (
      '<div class="pc-workspace v3-detail-workspace" data-testid="v3-detail-card">' +
      '<header class="client-detail-header">' +
      '<h1 data-testid="v3-detail-title">' +
      esc(shell, title) +
      "</h1>" +
      '<p class="pc-subtitle v3-detail-subtitle" data-testid="v3-detail-subtitle">' +
      esc(shell, entityKindLabel(entityType) + " · обзор из обмена 1С") +
      "</p></header>" +
      renderTabsMarkup() +
      renderRoleContextBlock(shell, options.session) +
      panels +
      "</div>"
    );
  }

  function bindTabs(root, context) {
    if (!root) return;
    var workspace = root.querySelector(".v3-detail-workspace");
    if (!workspace) return;
    var titleEl = workspace.querySelector('[data-testid="v3-detail-title"]');
    var subtitleEl = workspace.querySelector('[data-testid="v3-detail-subtitle"]');
    var baseTitle = (context && context.title) || (titleEl && titleEl.textContent) || "";
    var entityLabel = (context && context.entityLabel) || "";

    function select(id, focus) {
      TABS.forEach(function (t) {
        var tabId = t[0];
        var btn = workspace.querySelector("#pc-tab-" + tabId);
        var panel = workspace.querySelector("#pc-panel-" + tabId);
        if (!btn || !panel) return;
        var selected = id === tabId;
        btn.setAttribute("aria-selected", String(selected));
        btn.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
        if (selected && focus) {
          btn.focus();
          btn.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
      if (titleEl) {
        titleEl.textContent = id === "data" ? "Данные и условия клиента · " + baseTitle : baseTitle;
      }
      if (subtitleEl) {
        subtitleEl.textContent =
          id === "data"
            ? baseTitle
            : (entityLabel || "Объект") + " · обзор из обмена 1С";
      }
    }

    workspace.querySelectorAll("[data-card-tab]").forEach(function (btn, index) {
      btn.addEventListener("click", function () {
        select(btn.getAttribute("data-card-tab") || "overview", false);
      });
      btn.addEventListener("keydown", function (event) {
        var next;
        if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
        if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = TABS.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          select(TABS[next][0], true);
        }
      });
    });
    workspace.querySelectorAll("[data-card-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        select(btn.getAttribute("data-card-open") || "data", true);
      });
    });
  }

  root.ClientDetailV3 = {
    renderCard: renderCard,
    bindTabs: bindTabs,
    /** @deprecated use renderCard */
    renderBody: function (shell, entityType, ent, holdingLink) {
      return renderCard(shell, entityType, ent, holdingLink);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
