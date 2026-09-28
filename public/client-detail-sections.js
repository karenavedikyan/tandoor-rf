(function () {
  "use strict";

  var PENDING_NOTICE = "Подключение данных не завершено";

  var FUTURE_DATA_ITEMS = [
    "Юрлица и реквизиты",
    "Торговые точки",
    "Региональный менеджер и руководитель отдела продаж (РОП)",
    "Коммерческие условия (скидки и наценки)",
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    var s = String(value).trim();
    return s.length > 0 ? s : "—";
  }

  function fieldRow(label, valueHtml) {
    return (
      '<div class="legacy-field-row">' +
      '<dt class="legacy-field-row__label">' +
      escapeHtml(label) +
      "</dt>" +
      '<dd class="legacy-field-row__value">' +
      valueHtml +
      "</dd>" +
      "</div>"
    );
  }

  function collapsibleSection(id, title, bodyHtml, options) {
    var opts = options || {};
    var expanded = opts.expanded !== false;
    var openAttr = expanded ? " open" : "";
    return (
      '<section class="legacy-section legacy-section--collapsible" data-testid="' +
      escapeHtml(id) +
      '">' +
      '<details class="legacy-details"' +
      openAttr +
      ">" +
      '<summary class="legacy-details__summary">' +
      "<span>" +
      escapeHtml(title) +
      "</span>" +
      '<span class="legacy-details__chevron" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="legacy-details__body">' +
      bodyHtml +
      "</div>" +
      "</details>" +
      "</section>"
    );
  }

  function openSection(id, title, bodyHtml) {
    return (
      '<section class="legacy-section" data-testid="' +
      escapeHtml(id) +
      '">' +
      '<h2 class="legacy-section__title">' +
      escapeHtml(title) +
      "</h2>" +
      '<div class="legacy-section__body">' +
      bodyHtml +
      "</div>" +
      "</section>"
    );
  }

  function renderHeader(client, returnQuery, escapeFn) {
    var esc = escapeFn || escapeHtml;
    return (
      '<header class="client-detail-header">' +
      '<nav class="client-detail-breadcrumb" aria-label="Навигация">' +
      '<a class="clients-link" href="/clients' +
      esc(returnQuery) +
      '">Клиенты</a>' +
      '<span class="client-detail-breadcrumb__sep" aria-hidden="true">/</span>' +
      '<span class="client-detail-breadcrumb__current">' +
      esc(client.name || "Клиент") +
      "</span>" +
      "</nav>" +
      '<div class="client-detail-header__actions">' +
      '<a class="workspace-button workspace-button--ghost" href="/clients' +
      esc(returnQuery) +
      '">← К списку</a>' +
      "</div>" +
      "</header>"
    );
  }

  function renderMainSection() {
    return (
      openSection(
        "section-main",
        "Сведения",
        '<dl class="legacy-field-list">' +
          fieldRow(
            "Клиент",
            '<span id="client-name" class="client-detail-name client-detail-value"></span>',
          ) +
          fieldRow("Холдинг", '<span id="client-holding-name" class="client-detail-value"></span>') +
          fieldRow(
            "Менеджер из 1С",
            '<span id="client-manager-name" class="client-detail-value"></span>',
          ) +
          "</dl>",
      )
    );
  }

  function renderContactsSection() {
    return (
      openSection(
        "section-contacts",
        "Контакты",
        '<dl class="legacy-field-list">' +
          fieldRow("Адрес", '<span id="client-address" class="client-detail-value"></span>') +
          '<div class="client-detail-copy-row">' +
          '<button type="button" id="copy-address" class="workspace-button workspace-button--secondary">Копировать адрес</button>' +
          '<p id="copy-address-status" class="workspace-status" role="status" aria-live="polite"></p>' +
          "</div>" +
          fieldRow("Телефоны", '<div id="client-phones" class="client-detail-phones"></div>') +
          "</dl>",
      )
    );
  }

  function renderSourceSection() {
    return (
      openSection(
        "section-source",
        "Источник и обновление",
        '<dl class="legacy-field-list">' +
          fieldRow("Источник", '<span class="legacy-badge">1С</span>') +
          fieldRow("Загружено в ЛК", '<span id="client-loaded-at" class="client-detail-value"></span>') +
          fieldRow(
            "Обновление в 1С",
            '<span id="client-source-updated" class="client-detail-value client-detail-value--muted"></span>',
          ) +
          "</dl>",
      )
    );
  }

  function renderFutureDataSection() {
    var list = FUTURE_DATA_ITEMS.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("");
    var body =
      '<div class="legacy-pending-block">' +
      '<p class="legacy-pending-block__notice">' +
      escapeHtml(PENDING_NOTICE) +
      "</p>" +
      '<ul class="legacy-pending-block__labels">' +
      list +
      "</ul>" +
      "</div>";
    return collapsibleSection("section-future-data", "Неподключённые данные", body, { expanded: false });
  }

  function renderTechSection() {
    var body =
      '<p class="client-detail-note client-detail-note--tech">Технические идентификаторы записи из обмена 1С. Тип записи уточняется у специалиста 1С.</p>' +
      '<dl class="legacy-field-list">' +
      fieldRow("guid_client", '<span id="client-uuid" class="client-detail-uuid"></span>') +
      fieldRow("guid_holding", '<span id="client-holding-uuid" class="client-detail-uuid"></span>') +
      fieldRow("guid_manager", '<span id="client-manager-uuid" class="client-detail-uuid"></span>') +
      "</dl>";
    return collapsibleSection("section-tech", "Технические идентификаторы", body, { expanded: false });
  }

  function renderAllSections(returnQuery) {
    return (
      renderHeader({ name: "" }, returnQuery) +
      '<div id="client-detail-sections" class="client-detail-sections">' +
      renderMainSection() +
      renderContactsSection() +
      renderSourceSection() +
      renderFutureDataSection() +
      renderTechSection() +
      "</div>"
    );
  }

  function initCollapsibles(root) {
    if (!root) {
      return;
    }
    root.querySelectorAll(".legacy-details").forEach(function (details) {
      if (details.getAttribute("data-collapsible-init") === "true") {
        return;
      }
      var summary = details.querySelector("summary");
      if (!summary) {
        return;
      }
      details.setAttribute("data-collapsible-init", "true");
      summary.setAttribute("role", "button");
      var setExpanded = function () {
        summary.setAttribute("aria-expanded", details.open ? "true" : "false");
      };
      setExpanded();
      details.addEventListener("toggle", setExpanded);
    });
  }

  function countCollapsibleListeners(root) {
    if (!root) {
      return 0;
    }
    var count = 0;
    root.querySelectorAll(".legacy-details").forEach(function (details) {
      if (details.getAttribute("data-collapsible-init") === "true") {
        count += 1;
      }
    });
    return count;
  }

  var exported = {
    PENDING_NOTICE: PENDING_NOTICE,
    FUTURE_DATA_ITEMS: FUTURE_DATA_ITEMS,
    renderAllSections: renderAllSections,
    renderHeader: renderHeader,
    initCollapsibles: initCollapsibles,
    countCollapsibleListeners: countCollapsibleListeners,
    escapeHtml: escapeHtml,
    dash: dash,
  };

  if (typeof window !== "undefined") {
    window.ClientDetailSections = exported;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})();
