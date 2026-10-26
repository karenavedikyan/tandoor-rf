(function (root) {
  "use strict";

  var TABS = [
    ["overview", "Обзор", true],
    ["data", "Данные", true],
    ["sales", "Продажи", true],
    ["work", "Работа", true],
    ["showcase", "Витрина", true],
    ["orders", "Заказы", true],
    ["finance", "Финансы", true],
    ["documents", "Документы", true],
    ["claims", "Рекламации", true],
    ["plan", "План", true],
  ];

  function visibleTabs(entityType) {
    return TABS.filter(function (t) {
      if (t[0] === "sales") {
        return entityType === "legal";
      }
      return true;
    });
  }

  function isConnectedTab(tabId, entityType) {
    return visibleTabs(entityType).some(function (t) {
      return t[0] === tabId;
    });
  }

  function resolveCardTab(tabId, entityType) {
    entityType = entityType || "legal";
    if (!tabId || !isConnectedTab(tabId, entityType)) {
      return "overview";
    }
    return tabId;
  }

  var UNAVAILABLE_SECTION_COPY = {
    work: "Раздел «Работа» ожидает данные из Битрикс24. Источник данных не подключён в ЛК.",
    showcase: "Витрина и каталог ожидают отдельный источник; в обмене 1С v3 только справочные поля витрин.",
    orders: "Заказы ожидают подключение учётной системы заказов, не файл clients JSON.",
    finance: "Финансовые показатели вне обмена clients v3; долг не вычисляется из лимитов 1С.",
    documents: "Документы ожидают подключение хранилища документов, не обмен clients.",
    claims: "Рекламации ожидают задачи Битрикс24. Источник данных не подключён в ЛК.",
    plan: "План продаж не передаётся в clients JSON; раздел ожидает подключение планирования.",
  };

  function defaultEscapeShell() {
    return {
      escapeHtml: function (value) {
        if (value === null || value === undefined) {
          return "";
        }
        return String(value).replace(/[&<>"']/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      },
    };
  }

  function esc(shell, value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    return (shell && shell.escapeHtml ? shell : defaultEscapeShell()).escapeHtml(String(value));
  }

  function emptyNoData() {
    return '<span class="pc-unavailable">Нет данных</span>';
  }

  function emptyFrom1C() {
    return '<span class="pc-unavailable">Нет данных из 1С</span>';
  }

  function emptyOtherNotIngested() {
    return '<span class="pc-unavailable">Данные из 1С ещё не загружены в карточку</span>';
  }

  function emptyOtherRestricted() {
    return '<span class="pc-unavailable">Скрыто политикой доступа</span>';
  }

  function otherFieldState(ent, key) {
    if (!ent || !ent.other_field_states || typeof ent.other_field_states !== "object") {
      return otherFieldsExchangeComplete(ent) ? "empty_1c" : "not_ingested";
    }
    return ent.other_field_states[key] || (otherFieldsExchangeComplete(ent) ? "empty_1c" : "not_ingested");
  }

  function emptyOtherForState(state) {
    if (state === "restricted") {
      return emptyOtherRestricted();
    }
    if (state === "not_ingested") {
      return emptyOtherNotIngested();
    }
    return emptyFrom1C();
  }

  function otherFieldsExchangeComplete(ent) {
    return Boolean(ent && ent.other_fields_exchange_complete);
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
      guidManager: managers.guidManager || managers.guid_manager || "",
      guidRegionalManager: managers.guidRegionalManager || managers.guid_regional_manager || "",
      guidHardwareManager: managers.guidHardwareManager || managers.guid_hardware_manager || "",
      guidHeadOfSales: managers.guidHeadOfSales || managers.guid_head_of_the_sales_department || "",
    };
  }

  function typeCategoryPlain(typeCat) {
    if (!typeCat || !typeCat.known) {
      return "Не передано";
    }
    return String(typeCat.html || "")
      .replace(/<[^>]+>/g, "")
      .trim() || "Не передано";
  }

  function formatTypeCategory(shell, tc) {
    if (!tc || typeof tc !== "object") {
      return { html: emptyFrom1C(), known: false };
    }
    var type = tc.nameType || tc.name_type || "";
    var cat = tc.nameCategory || tc.name_category || "";
    if (type && cat) {
      return { html: esc(shell, "ТОП: " + type + " · категория: " + cat), known: true };
    }
    if (type) {
      return { html: esc(shell, "ТОП: " + type), known: true };
    }
    if (cat) {
      return { html: esc(shell, "Категория: " + cat), known: true };
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

  var catalog = root.ClientDetailExchangeCatalog || {};
  var OTHER_FIELD_LABELS = catalog.otherFieldLabels || {};
  var OTHER_FIELD_GROUPS = catalog.otherFieldGroups || {
    requisites: ["Код", "НаименованиеПолное", "ЮрФизЛицо", "Оптовик_ОГРН"],
    location: ["Оптовик_КрайГород", "Оптовик_НаселенныйПункт", "БизнесРегион"],
    contractRefs: ["Оптовик_ОсновнойДоговор", "Оптовик_ОсновноеСоглашение"],
    debtControl: [
      "Оптовик_ДопустимаяСуммаЗадолженности",
      "Оптовик_ДопустимоеЧислоДнейЗадолженности",
      "Оптовик_КонтролироватьСуммуЗадолженности",
      "Оптовик_КонтролироватьЧислоДнейЗадолженности",
      "Оптовик_Неблагонадёжный",
      "Оптовик_Наличные",
    ],
    misc: ["Комментарий"],
  };
  var OTHER_GROUP_TITLES = catalog.groupTitles || {};
  var OTHER_DATE_KINDS = catalog.otherDateKinds || {};

  function otherFieldLabel(key) {
    return OTHER_FIELD_LABELS[key] || key;
  }

  function parseExchangeDateParts(value) {
    var iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/);
    if (iso) {
      return {
        year: Number(iso[1]),
        month: iso[2],
        day: iso[3],
        hour: iso[4].padStart(2, "0"),
        minute: iso[5],
      };
    }
    var ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (ru) {
      return {
        year: Number(ru[3]),
        month: ru[2],
        day: ru[1],
        hour: (ru[4] || "00").padStart(2, "0"),
        minute: ru[5] || "00",
      };
    }
    return null;
  }

  function formatExchangeDateValue(value, kind) {
    var parts = parseExchangeDateParts(value);
    if (!parts) {
      return value;
    }
    if (parts.year <= 1) {
      if (kind === "time") {
        return parts.hour + ":" + parts.minute;
      }
      if (kind === "date") {
        return null;
      }
      if (parts.hour === "00" && parts.minute === "00") {
        return null;
      }
      return parts.hour + ":" + parts.minute;
    }
    var dateText = parts.day + "." + parts.month + "." + parts.year;
    if (kind === "date") {
      return dateText;
    }
    if (parts.hour !== "00" || parts.minute !== "00") {
      return dateText + " " + parts.hour + ":" + parts.minute;
    }
    return dateText;
  }

  function formatOtherFieldScalar(value, fieldKey) {
    if (value === null || value === undefined) {
      return null;
    }
    if (value === "") {
      return null;
    }
    if (typeof value === "boolean") {
      return value ? "Да" : "Нет";
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      var kind = OTHER_DATE_KINDS[fieldKey] || "date";
      if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) || /^\d{2}\.\d{2}\.\d{4}/.test(trimmed)) {
        return formatExchangeDateValue(trimmed, kind);
      }
      return trimmed;
    }
    if (Array.isArray(value)) {
      var parts = value
        .map(function (item) {
          return formatOtherFieldScalar(item, fieldKey);
        })
        .filter(function (item) {
          return item != null && item !== "";
        });
      return parts.length ? parts.join(", ") : null;
    }
    if (typeof value === "object") {
      var inner = Object.keys(value)
        .map(function (k) {
          var v = formatOtherFieldScalar(value[k], k);
          return v != null && v !== "" ? k + ": " + v : null;
        })
        .filter(Boolean);
      return inner.length ? inner.join("; ") : null;
    }
    return String(value);
  }

  function renderOtherFieldsFromKeys(shell, other, keys, ent) {
    if (!keys || !keys.length) {
      return "";
    }
    var bag = other && typeof other === "object" ? other : {};
    var rows = [];
    keys.forEach(function (key) {
      var hasKey = Object.prototype.hasOwnProperty.call(bag, key);
      if (!hasKey) {
        rows.push(field(otherFieldLabel(key), emptyOtherForState(otherFieldState(ent, key)), false));
        return;
      }
      var text = formatOtherFieldScalar(bag[key], key);
      rows.push(
        field(
          otherFieldLabel(key),
          text != null && text !== "" ? esc(shell, text) : emptyFrom1C(),
          text != null && text !== "",
        ),
      );
    });
    return rows.join("");
  }

  function renderOtherFieldsByGroup(shell, ent, other) {
    var bag = other && typeof other === "object" ? other : {};
    var html = "";
    var groupedKeys = new Set();
    Object.keys(OTHER_FIELD_GROUPS).forEach(function (groupId) {
      (OTHER_FIELD_GROUPS[groupId] || []).forEach(function (key) {
        groupedKeys.add(key);
      });
      var body = renderOtherFieldsFromKeys(shell, bag, OTHER_FIELD_GROUPS[groupId], ent);
      if (body) {
        html += renderDataGroup(OTHER_GROUP_TITLES[groupId] || groupId, body);
      }
    });
    var extraKeys = Object.keys(bag)
      .filter(function (key) {
        return !groupedKeys.has(key);
      })
      .sort();
    if (extraKeys.length) {
      html += renderDataGroup(
        "Все данные 1С (дополнительные поля)",
        renderOtherFieldsFromKeys(shell, bag, extraKeys, ent),
      );
    }
    return html;
  }

  function renderDataGroup(title, innerHtml) {
    if (!innerHtml) {
      return "";
    }
    return (
      '<details class="x6-group v3-data-group" open><summary>' +
      title +
      "</summary><div class=\"v3-data-group__body\">" +
      innerHtml +
      "</div></details>"
    );
  }

  function encodedDetailReturnParam() {
    return encodeURIComponent(window.location.pathname + window.location.search);
  }

  function outletRetailHref(outletGuid, parentReturnEncoded) {
    return (
      "/clients/" +
      encodeURIComponent(outletGuid) +
      "?v3Entity=retail&return=" +
      (parentReturnEncoded || encodedDetailReturnParam())
    );
  }

  function refreshRelatedOutletReturnLinks(root) {
    if (!root) {
      return;
    }
    var parentReturn = encodedDetailReturnParam();
    root.querySelectorAll("a.x13-related-line[data-outlet-guid]").forEach(function (anchor) {
      var guid = anchor.getAttribute("data-outlet-guid");
      if (guid) {
        anchor.href = outletRetailHref(guid, parentReturn);
      }
    });
  }

  function legalEntityHref(guid, parentReturn) {
    return (
      "/clients/" +
      encodeURIComponent(guid) +
      "?v3Entity=legal&return=" +
      (parentReturn || encodedDetailReturnParam())
    );
  }

  function renderLegalScopedDetailPreview(shell, ent) {
    if (!ent) {
      return '<p class="pc-unavailable">Нет данных.</p>';
    }
    var other = ent.other_fields || ent.other || {};
    var contractKeys = ["Оптовик_ОсновнойДоговор", "Оптовик_ОсновноеСоглашение"];
    var contractHtml = renderOtherFieldsFromKeys(shell, other, contractKeys, ent);
    var commercialHtml = renderCommercialBlock(shell, ent);
    var phones = formatTelephones(shell, ent.telephone);
    return (
      '<div class="v3-legal-scoped-preview">' +
      field("ИНН", ent.inn ? esc(shell, String(ent.inn)) : emptyNoData(), Boolean(ent.inn)) +
      field("КПП", ent.kpp ? esc(shell, String(ent.kpp)) : emptyNoData(), Boolean(ent.kpp)) +
      field("Адрес", ent.address ? esc(shell, ent.address) : emptyNoData(), Boolean(ent.address)) +
      field("Телефоны", phones.html, phones.known) +
      renderDataGroup("Договор и соглашение", contractHtml || field("Договор", emptyFrom1C(), false)) +
      renderDataGroup("Коммерческие условия", commercialHtml) +
      "</div>"
    );
  }

  function renderLegalLazyExpandItem(shell, row, parentReturn) {
    var meta = [];
    if (row.inn) meta.push("ИНН " + row.inn);
    if (row.kpp) meta.push("КПП " + row.kpp);
    var guid = row.guid || row.guid_client || "";
    return (
      '<details class="x6-group v3-legal-lazy-expand" data-legal-guid="' +
      esc(shell, guid) +
      '"><summary class="v3-legal-lazy-expand__summary">' +
      '<span class="v3-legal-lazy-expand__title">' +
      esc(shell, row.name || guid) +
      (meta.length ? ' <span class="pc-label">' + esc(shell, meta.join(" · ")) + "</span>" : "") +
      '</span><a class="clients-link v3-legal-lazy-expand__card-link" href="' +
      legalEntityHref(guid, parentReturn) +
      '">Карточка</a></summary><div class="v3-legal-lazy-expand__body pc-label">' +
      "Раскройте для загрузки реквизитов и договора из 1С." +
      "</div></details>"
    );
  }

  function bindLegalLazyExpansions(root, requestFn, shell) {
    if (!root || typeof requestFn !== "function") {
      return;
    }
    shell = shell || defaultEscapeShell();
    root.querySelectorAll(".v3-legal-lazy-expand").forEach(function (details) {
      if (details.dataset.lazyBound === "1") {
        return;
      }
      details.dataset.lazyBound = "1";
      details.addEventListener("toggle", function () {
        if (!details.open || details.dataset.lazyLoaded === "1") {
          return;
        }
        var guid = details.getAttribute("data-legal-guid");
        if (!guid) {
          return;
        }
        var body = details.querySelector(".v3-legal-lazy-expand__body");
        if (!body) {
          return;
        }
        body.textContent = "Загрузка…";
        requestFn(guid)
          .then(function (result) {
            if (!details.isConnected) {
              return;
            }
            if (!result || !result.response || !result.response.ok || !result.data || !result.data.entity) {
              body.innerHTML = '<p class="pc-unavailable">Не удалось загрузить реквизиты.</p>';
              return;
            }
            details.dataset.lazyLoaded = "1";
            body.innerHTML = renderLegalScopedDetailPreview(shell, result.data.entity);
          })
          .catch(function () {
            if (body.isConnected) {
              body.innerHTML = '<p class="pc-unavailable">Ошибка сети.</p>';
            }
          });
      });
    });
  }

  function renderRelatedLegalLines(shell, legals, parentReturn) {
    if (!legals.length) {
      return '<span class="pc-unavailable">В вашей области нет доступных юрлиц этого холдинга.</span>';
    }
    return legals
      .map(function (row) {
        return renderLegalLazyExpandItem(shell, row, parentReturn);
      })
      .join("");
  }

  function renderInlineDisclosure(shell, title, innerHtml) {
    if (!innerHtml) {
      return "";
    }
    return (
      '<details class="x6-group v3-inline-disclosure" open><summary>' +
      esc(shell, title) +
      '</summary><div class="v3-inline-disclosure__body">' +
      innerHtml +
      "</div></details>"
    );
  }

  function renderRelatedOutletLines(shell, outlets, parentReturn) {
    if (!outlets.length) {
      return '<span class="pc-unavailable">В вашей области нет доступных торговых точек этого холдинга.</span>';
    }
    return outlets
      .map(function (row) {
        return (
          '<a class="x13-related-line" data-outlet-guid="' +
          shell.escapeHtml(row.guid) +
          '" href="' +
          outletRetailHref(row.guid, parentReturn) +
          '"><span>' +
          shell.escapeHtml(row.name || row.guid) +
          '</span><span class="x13-related-line__arrow" aria-hidden="true">→</span></a>'
        );
      })
      .join("");
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
    var timeRaw = loading.loadingTime || loading.loading_time || "";
    var time = timeRaw ? formatOtherFieldScalar(String(timeRaw), "loading_time") : null;
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
      var dob = formatOtherFieldScalar(String(lpr.date_of_birth || lpr.dateOfBirth), "ДатаРождения");
      rows.push(
        field("Дата рождения", dob ? esc(shell, dob) : emptyFrom1C(), Boolean(dob)),
      );
    }
    if (lpr.bonus != null && lpr.bonus !== "") {
      rows.push(field("Бонус", esc(shell, String(lpr.bonus)), true));
    }
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
    return renderResponsibilitySection(shell, managersRaw, "client");
  }

  function assignmentRow(shell, label, name, guid) {
    var nameHtml = name ? esc(shell, name) : '<span class="pc-unavailable">Не назначен в 1С</span>';
    var guidText = guid ? esc(shell, guid) : "не назначен";
    return (
      '<div class="x6-assignment">' +
      "<span>" +
      esc(shell, label) +
      "</span><strong>" +
      nameHtml +
      '</strong><code class="client-detail-uuid">GUID: ' +
      guidText +
      "</code></div>"
    );
  }

  function renderResponsibilitySection(shell, managersRaw, scopeLabel) {
    var managers = normalizeManagers(managersRaw);
    var title = scopeLabel === "outlet" ? "Ответственные этой ТТ" : "Ответственные клиента";
    if (!managers) {
      return (
        '<details class="x6-group v3-responsibilities" open><summary>' +
        esc(shell, title) +
        "</summary>" +
        assignmentRow(shell, "Менеджер", "", "") +
        assignmentRow(shell, "Региональный", "", "") +
        assignmentRow(shell, "По фурнитуре", "", "") +
        assignmentRow(shell, "РОП", "", "") +
        "</details>"
      );
    }
    return (
      '<details class="x6-group v3-responsibilities" open><summary>' +
      esc(shell, title) +
      "</summary>" +
      assignmentRow(shell, "Менеджер", managers.nameManager, managers.guidManager) +
      assignmentRow(shell, "Региональный", managers.nameRegionalManager, managers.guidRegionalManager) +
      assignmentRow(shell, "По фурнитуре", managers.nameHardwareManager, managers.guidHardwareManager) +
      assignmentRow(shell, "РОП", managers.nameHeadOfSales, managers.guidHeadOfSales) +
      "</details>"
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

  function overviewKpis(shell, entityType, typeCat, counts) {
    counts = counts || {};
    var retailCount =
      counts.retailOutlets != null
        ? counts.retailOutlets
        : entityType === "retail"
          ? 1
          : null;
    var legalCount =
      entityType === "legal" ? 1 : counts.legalEntities != null ? counts.legalEntities : null;
    function kpi(label, value) {
      var display =
        value == null || value === ""
          ? '<span class="pc-unavailable">—</span>'
          : esc(shell, String(value));
      return '<div><span class="pc-label">' + esc(shell, label) + "</span><b>" + display + "</b></div>";
    }
    return (
      '<div class="x13-kpis v3-overview-kpis" aria-label="Сводка из 1С" data-testid="v3-overview-kpis">' +
      kpi("Торговые точки", retailCount) +
      kpi("Юридические лица", legalCount) +
      kpi("ТОП / тип", typeCategoryPlain(typeCat)) +
      "</div>"
    );
  }

  function renderRelatedOutletsCard() {
    return (
      card(
        "Доступные точки холдинга",
        '<div class="pc-pad" id="v3-related-outlets" data-testid="v3-related-outlets">' +
          '<span class="pc-unavailable">Загрузка точек в вашей области…</span>' +
          '<p class="pc-label v3-related-outlets-note">Только ТТ холдинга в вашей области видимости, не весь состав.</p></div>',
        "1С / область",
      )
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
    var relatedCard =
      entityType === "holding"
        ? card(
            "Состав холдинга",
            '<div class="pc-pad"><p class="pc-unavailable">Юрлица и ТТ — на вкладке «Данные» и в блоке состава ниже.</p></div>',
            "1С",
          )
        : holdingLink && holdingLink.guid
          ? renderRelatedOutletsCard()
          : card(
              "Доступные точки холдинга",
              '<div class="pc-pad"><span class="pc-unavailable">Связь с холдингом не передана из 1С — список ТТ недоступен.</span></div>',
              "1С",
            );
    return (
      freshnessMeta(shell, ent) +
      overviewKpis(shell, entityType, typeCat, {}) +
      '<div id="v3-client-sales-overview-host" data-testid="v3-client-sales-overview-host"></div>' +
      '<div class="x6-responsibilities v3-responsibilities-wrap">' +
      renderResponsibilitySection(shell, ent.managers, entityType === "retail" ? "outlet" : "client") +
      "</div>" +
      '<div class="x13-card-grid">' +
      renderPointsAndContactsCard(shell, entityType, ent, holdingLink, typeCat) +
      relatedCard +
      "</div>"
    );
  }

  function renderCommercialBlock(shell, ent) {
    var markups = formatMarkups(shell, ent.markups);
    var discountKnown = ent.discount != null && ent.discount !== "";
    var discountAmountKnown = ent.discount_amount != null && ent.discount_amount !== "";
    return (
      field("Скидочная программа", discountKnown ? esc(shell, ent.discount) : emptyNoData(), discountKnown) +
      field(
        "Значение скидки",
        discountAmountKnown ? esc(shell, ent.discount_amount) : emptyNoData(),
        discountAmountKnown,
      ) +
      field("Наценки", markups.html, markups.known)
    );
  }

  function renderDataLegal(shell, ent, holdingLink, typeCat) {
    var holding = formatHoldingLink(shell, holdingLink);
    var phones = formatTelephones(shell, ent.telephone);
    var other = ent.other_fields || ent.other;
    var clientBlock =
      field("Клиент / категория", typeCat.html, typeCat.known) +
      field("Название", esc(shell, ent.name_client || ent.name), Boolean(ent.name_client || ent.name)) +
      field(
        "ИНН",
        ent.inn ? esc(shell, String(ent.inn)) : emptyNoData(),
        Boolean(ent.inn && String(ent.inn).trim()),
      ) +
      field(
        "КПП",
        ent.kpp ? esc(shell, String(ent.kpp)) : emptyNoData(),
        Boolean(ent.kpp && String(ent.kpp).trim()),
      ) +
      field("Адрес", ent.address ? esc(shell, ent.address) : emptyNoData(), Boolean(ent.address)) +
      field("Телефоны", phones.html, phones.known) +
      field("Холдинг", holding.html, holding.known);
    var respBlock = renderResponsibilitySection(shell, ent.managers, "client");
    return (
      '<div class="v3-data-sequential">' +
      renderDataGroup("Клиент и холдинг", clientBlock) +
      renderDataGroup("Ответственные", respBlock.replace(/<details[^>]*>|<\/details>|<summary>[^<]*<\/summary>/g, "")) +
      renderDataGroup("Коммерческие условия", renderCommercialBlock(shell, ent)) +
      renderOtherFieldsByGroup(shell, ent, other) +
      renderDataGroup(
        "Доступные юрлица холдинга",
        '<div id="v3-data-holding-legals" data-testid="v3-data-holding-legals">' +
          '<span class="pc-unavailable">Загрузка…</span></div>',
      ) +
      renderDataGroup(
        "Торговая точка (уровень юрлица)",
        field(
          "Доставка, приёмка, ЛПР, Club",
          "См. доступные торговые точки холдинга ниже и карточки ТТ.",
          true,
        ),
      ) +
      renderDataGroup(
        "Доступные точки холдинга",
        '<div id="v3-data-holding-outlets" data-testid="v3-data-holding-outlets">' +
          '<span class="pc-unavailable">Загрузка…</span></div>',
      ) +
      "</div>"
    );
  }

  function renderDataRetail(shell, ent, holdingLink, typeCat) {
    var holding = formatHoldingLink(shell, holdingLink);
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    var route = addr.direction_of_the_route || addr.directionOfTheRoute;
    var loading = formatLoading(shell, ent.information_loading);
    var outletBlock =
      field("Тип и категория", typeCat.html, typeCat.known) +
      field("Холдинг", holding.html, holding.known) +
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
      field("Закрыта", boolLabel(ent.closed), ent.closed != null);
    var deliveryBlock = field("Приёмка", loading.html, loading.known) + formatContactsFields(shell, ent.contact_information);
    var lprClub =
      formatLprBlock(shell, ent.lpr_information) + formatClubFields(shell, ent.additional_information);
    var stripDetails = function (html) {
      return html.replace(/<details[^>]*>|<\/details>|<summary>[^<]*<\/summary>/g, "");
    };
    return (
      '<div class="v3-data-sequential">' +
      renderDataGroup("Торговая точка", outletBlock) +
      renderDataGroup("Ответственные клиента", '<p class="pc-unavailable">Назначения клиента отдельно не переданы в карточке этой ТТ.</p>') +
      renderDataGroup("Ответственные этой ТТ", stripDetails(renderResponsibilitySection(shell, ent.managers, "outlet"))) +
      renderDataGroup("Доставка и приёмка", deliveryBlock) +
      renderDataGroup("Контакты, ЛПР и Club", lprClub) +
      renderDataGroup(
        "Доступные точки холдинга",
        '<div id="v3-data-holding-outlets" data-testid="v3-data-holding-outlets">' +
          '<span class="pc-unavailable">Загрузка…</span></div>',
      ) +
      "</div>"
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

  function renderUnavailablePanel(id, label, visible) {
    return (
      '<section id="pc-panel-' +
      id +
      '" class="v3-detail-panel v3-detail-panel--unavailable" role="tabpanel" aria-labelledby="pc-tab-' +
      id +
      '"' +
      (visible ? "" : " hidden") +
      ">" +
      '<section class="card pad x13-demo-section x13-empty-section">' +
      "<header><div><span class=\"pc-tag\">Не подключено к ЛК</span><h3>" +
      label +
      "</h3></div></header>" +
      '<p class="pc-unavailable">' +
      (UNAVAILABLE_SECTION_COPY[id] || "Раздел недоступен в v3-карточке.") +
      "</p>" +
      '<p class="pc-label">Демонстрационные суммы и заказы из прототипа здесь не показываются.</p></section></section>'
    );
  }

  function renderTabsMarkup(initialTab, entityType) {
    entityType = entityType || "legal";
    initialTab = resolveCardTab(initialTab || "overview", entityType);
    var tabs = visibleTabs(entityType);
    return (
      '<nav class="x13-card-tabs pc-tabs" role="tablist" aria-label="Разделы карточки">' +
      tabs.map(function (t, i) {
        var selected = initialTab === t[0];
        return (
          '<button type="button" role="tab" class="' +
          (selected ? "selected" : "") +
          '" id="pc-tab-' +
          t[0] +
          '" data-card-tab="' +
          t[0] +
          '" aria-controls="pc-panel-' +
          t[0] +
          '" aria-selected="' +
          selected +
          '" tabindex="' +
          (selected ? 0 : -1) +
          '">' +
          t[1] +
          "</button>"
        );
      }).join("") +
      "</nav>"
    );
  }

  function readInitialCardTab(entityType) {
    try {
      var tab = new URLSearchParams(root.location.search).get("cardTab") || "overview";
      return resolveCardTab(tab, entityType);
    } catch (_err) {
      return "overview";
    }
  }

  function formatSaleNumber(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    var num = Number(value);
    if (!Number.isFinite(num)) {
      return String(value);
    }
    return num.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function renderSalesPanelShell(visible) {
    return (
      '<section id="pc-panel-sales" class="v3-detail-panel v3-sales-panel" role="tabpanel" aria-labelledby="pc-tab-sales"' +
      (visible ? "" : " hidden") +
      ' data-testid="v3-sales-panel">' +
      '<div class="v3-sales-host" data-testid="v3-sales-host">' +
      '<p class="pc-unavailable">Загрузка продаж…</p></div></section>'
    );
  }

  function writeCardTabQuery(tab) {
    try {
      var url = new URL(root.location.href);
      if (!tab || tab === "overview") {
        url.searchParams.delete("cardTab");
      } else {
        url.searchParams.set("cardTab", tab);
      }
      root.history.replaceState(null, "", url.pathname + url.search);
    } catch (_err) {
      /* ignore */
    }
  }

  function renderCard(shell, entityType, ent, holdingLink, options) {
    options = options || {};
    var initialTab = resolveCardTab(options.initialTab || readInitialCardTab(entityType), entityType);
    try {
      var requestedTab = new URLSearchParams(root.location.search).get("cardTab");
      if (requestedTab && requestedTab !== initialTab) {
        writeCardTabQuery(initialTab);
      }
    } catch (_sanitizeErr) {
      /* ignore */
    }
    var typeCat = formatTypeCategory(shell, ent.type_category);
    var title = resolveTitle(entityType, ent);
    var overviewHtml = renderOverviewPanel(shell, entityType, ent, holdingLink, typeCat);
    var dataHtml =
      entityType === "holding"
        ? renderDataHolding(shell, ent, typeCat)
        : entityType === "legal"
          ? renderDataLegal(shell, ent, holdingLink, typeCat)
          : renderDataRetail(shell, ent, holdingLink, typeCat);

    function panelVisibility(tabId) {
      return initialTab === tabId ? "" : " hidden";
    }

    var panels =
      '<section id="pc-panel-overview" class="v3-detail-panel" role="tabpanel" aria-labelledby="pc-tab-overview"' +
      panelVisibility("overview") +
      ">" +
      overviewHtml +
      "</section>" +
      '<section id="pc-panel-data" class="v3-detail-panel" role="tabpanel" aria-labelledby="pc-tab-data"' +
      panelVisibility("data") +
      ">" +
      dataHtml +
      "</section>" +
      (entityType === "legal" ? renderSalesPanelShell(initialTab === "sales") : "");
    TABS.forEach(function (t) {
      var tabId = t[0];
      if (tabId === "overview" || tabId === "data" || tabId === "sales") {
        return;
      }
      if (tabId === "sales" && entityType !== "legal") {
        return;
      }
      panels += renderUnavailablePanel(tabId, t[1], initialTab === tabId);
    });

    var subtitleParts = [entityKindLabel(entityType)];
    if (typeCat.known) {
      subtitleParts.push(typeCategoryPlain(typeCat));
    }
    var addrLine = "";
    if (entityType === "retail") {
      var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
      addrLine = addr.store_address || addr.storeAddress || "";
    } else if (entityType === "legal") {
      addrLine = ent.address ? String(ent.address) : "";
    }

    return (
      '<div class="pc-workspace v3-detail-workspace x13 x6" data-testid="v3-detail-card">' +
      '<div class="x13-record-title">' +
      '<span class="pc-tag">' +
      esc(shell, entityKindLabel(entityType)) +
      "</span>" +
      '<h1 data-testid="v3-detail-title">' +
      esc(shell, title) +
      "</h1>" +
      '<p class="pc-subtitle v3-detail-subtitle" data-testid="v3-detail-subtitle">' +
      esc(shell, addrLine || subtitleParts.join(" · ")) +
      "</p></div>" +
      renderTabsMarkup(initialTab, entityType) +
      panels +
      "</div>"
    );
  }

  function renderSalesContent(shell, payload) {
    payload = payload || {};
    var sales = payload.sales || {};
    var lines = sales.lines || [];
    var salesState = payload.salesState || (lines.length ? "loaded" : "empty_month");
    if (!lines.length) {
      var emptyCopy =
        salesState === "not_imported"
          ? "Данные из 1С ещё не загружены в ЛК (файл продаж не применён)."
          : salesState === "error"
            ? "Не удалось загрузить продажи. Повторите позже."
            : salesState === "forbidden"
              ? "Продажи недоступны в вашей области видимости."
              : "Нет строк продаж за выбранный месяц.";
      return (
        '<section class="card pad x13-empty-section" data-testid="v3-sales-empty">' +
        "<header><h3>Продажи</h3></header>" +
        '<p class="pc-unavailable">' +
        esc(shell, emptyCopy) +
        "</p>" +
        '<p class="pc-label">' +
        esc(shell, sales.vatNote || "Суммы с НДС, ₽") +
        "</p></section>"
      );
    }
    var monthSelect =
      '<label class="pc-label v3-sales-month-label">Месяц ' +
      '<select class="v3-sales-month-select" data-testid="v3-sales-month-select">';
    (payload.months || [sales.month]).forEach(function (m) {
      monthSelect +=
        '<option value="' +
        esc(shell, m) +
        '"' +
        (m === sales.month ? " selected" : "") +
        ">" +
        esc(shell, m) +
        "</option>";
    });
    monthSelect += "</select></label>";
    var summary =
      '<div class="x13-kpis v3-sales-kpis" data-testid="v3-sales-kpis">' +
      "<div><span>Выручка</span><b>" +
      formatSaleNumber(sales.incomeTotal) +
      "</b></div>" +
      "<div><span>Количество, шт</span><b>" +
      formatSaleNumber(sales.quantityTotal) +
      "</b></div>";
    if (sales.grossProfitTotal != null) {
      summary +=
        "<div><span>Валовая прибыль</span><b>" +
        formatSaleNumber(sales.grossProfitTotal) +
        "</b></div>" +
        "<div><span>Рентабельность</span><b>" +
        (sales.profitabilityPercent != null ? formatSaleNumber(sales.profitabilityPercent) + "%" : "—") +
        "</b></div>";
    }
    summary += "</div>";
    var rows = lines
      .map(function (line) {
        var detail =
          '<details class="v3-sales-line-details"><summary>Детализация</summary><ul class="v3-sales-detail-list">' +
          "<li>Ручная скидка: " +
          formatSaleNumber(line.manualDiscount) +
          "</li>" +
          "<li>Авто скидка: " +
          formatSaleNumber(line.automaticDiscount) +
          "</li>" +
          "<li>Итого скидок: " +
          formatSaleNumber(line.totalDiscount) +
          "</li>";
        if (line.costPrice != null) {
          detail +=
            "<li>Себестоимость: " +
            formatSaleNumber(line.costPrice) +
            "</li><li>Доп. расходы: " +
            formatSaleNumber(line.additionalExpenses) +
            "</li><li>Валовая прибыль: " +
            formatSaleNumber(line.grossProfit) +
            "</li><li>Рентабельность: " +
            formatSaleNumber(line.profitability) +
            "%</li>";
        }
        detail += "</ul></details>";
        return (
          "<tr><td>" +
          esc(shell, line.productType) +
          "</td><td class=\"num\">" +
          formatSaleNumber(line.quantity) +
          '</td><td class="num">' +
          formatSaleNumber(line.income) +
          "</td><td>" +
          detail +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<section class="card pad v3-sales-card" data-testid="v3-sales-content">' +
      "<header><h3>Продажи из 1С</h3>" +
      monthSelect +
      "</header>" +
      summary +
      '<div class="v3-sales-table-wrap"><table class="v3-sales-table"><thead><tr><th>Категория</th><th>Кол-во, шт</th><th>Выручка, ₽</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<p class="pc-label">' +
      esc(shell, sales.vatNote || "Суммы с НДС, ₽") +
      "</p></section>"
    );
  }

  function updateRelatedContext(root, shell, payload) {
    if (!root) return;
    shell = shell || { escapeHtml: function (v) { return String(v ?? ""); } };
    var kpis = root.querySelector('[data-testid="v3-overview-kpis"]');
    var host = root.querySelector('[data-testid="v3-related-outlets"]');
    var dataHost = root.querySelector('[data-testid="v3-data-holding-outlets"]');
    var legalHost = root.querySelector('[data-testid="v3-data-holding-legals"]');
    var counts = payload.counts || {};
    var entityType = payload.entityType || "legal";
    if (kpis && counts.retailOutlets != null) {
      var boxes = kpis.querySelectorAll("b");
      if (boxes[0]) boxes[0].textContent = String(counts.retailOutlets);
      if (boxes[1]) {
        if (entityType === "legal") {
          boxes[1].textContent = "1";
        } else if (counts.legalEntities != null) {
          boxes[1].textContent = String(counts.legalEntities);
        }
      }
    }
    var outlets = payload.retailOutlets || [];
    var legals = payload.legalEntities || [];
    var parentReturn = payload.parentReturn || "";
    var outletLines = renderRelatedOutletLines(shell, outlets, parentReturn);
    var outletBlock = renderInlineDisclosure(
      shell,
      "Торговые точки (" + outlets.length + ")",
      outletLines,
    );
    var legalLines = renderRelatedLegalLines(shell, legals, parentReturn);
    var legalBlock = renderInlineDisclosure(shell, "Юрлица (" + legals.length + ")", legalLines);
    if (host) {
      host.innerHTML = outletBlock;
    }
    if (dataHost) {
      dataHost.innerHTML = outletBlock;
    }
    if (legalHost) {
      legalHost.innerHTML = legalBlock;
    }
    refreshRelatedOutletReturnLinks(root);
    if (typeof root.ClientDetailV3LazyRequest === "function") {
      bindLegalLazyExpansions(root, root.ClientDetailV3LazyRequest, shell);
    }
  }

  function bindTabs(root, context) {
    if (!root) return;
    var workspace = root.querySelector(".v3-detail-workspace");
    if (!workspace) return;
    var titleEl = workspace.querySelector('[data-testid="v3-detail-title"]');
    var subtitleEl = workspace.querySelector('[data-testid="v3-detail-subtitle"]');
    var baseTitle = (context && context.title) || (titleEl && titleEl.textContent) || "";
    var entityLabel = (context && context.entityLabel) || "";

    var entityType = (context && context.entityType) || "legal";
    var tabs = visibleTabs(entityType);

    function select(id, focus) {
      id = resolveCardTab(id, entityType);
      tabs.forEach(function (t) {
        var tabId = t[0];
        var btn = workspace.querySelector("#pc-tab-" + tabId);
        var panel = workspace.querySelector("#pc-panel-" + tabId);
        if (!btn || !panel) return;
        var selected = id === tabId;
        btn.setAttribute("aria-selected", String(selected));
        btn.tabIndex = selected ? 0 : -1;
        btn.classList.toggle("selected", selected);
        panel.hidden = !selected;
        if (selected && focus) {
          btn.focus();
          btn.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
      writeCardTabQuery(id);
      refreshRelatedOutletReturnLinks(root);
      if (id === "sales" && context && typeof context.onSalesTabSelected === "function") {
        context.onSalesTabSelected();
      }
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
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          select(tabs[next][0], true);
        }
      });
    });
    workspace.querySelectorAll("[data-card-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        select(btn.getAttribute("data-card-open") || "data", true);
      });
    });

    var initialTab = readInitialCardTab(entityType);
    if (initialTab !== "overview") {
      select(initialTab, false);
    }
    if (initialTab === "sales" && context && typeof context.onSalesTabSelected === "function") {
      context.onSalesTabSelected();
    }
  }

  root.ClientDetailV3 = {
    renderOtherFieldsFromKeys: renderOtherFieldsFromKeys,
    renderLegalScopedDetailPreview: renderLegalScopedDetailPreview,
    renderLegalLazyExpandItem: renderLegalLazyExpandItem,
    bindLegalLazyExpansions: bindLegalLazyExpansions,
    renderCard: renderCard,
    bindTabs: bindTabs,
    updateRelatedContext: updateRelatedContext,
    renderSalesContent: renderSalesContent,
    visibleTabs: visibleTabs,
    resolveCardTab: resolveCardTab,
    readInitialCardTab: readInitialCardTab,
    renderTabsMarkup: renderTabsMarkup,
    /** @deprecated use renderCard */
    renderBody: function (shell, entityType, ent, holdingLink) {
      return renderCard(shell, entityType, ent, holdingLink);
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      visibleTabs: visibleTabs,
      resolveCardTab: resolveCardTab,
      readInitialCardTab: readInitialCardTab,
      renderTabsMarkup: renderTabsMarkup,
      renderSalesContent: renderSalesContent,
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
