(function () {
  "use strict";

  var PENDING_NOTICE = "Подключение данных не завершено";

  var REQUISITES_LABELS = [
    "Юридическое наименование",
    "ИНН",
    "КПП",
    "ОГРН",
    "Номер MA",
    "Регион",
    "Город",
    "Email",
  ];

  var COMMERCIAL_GROUPS = [
    {
      title: "Условия",
      labels: ["Тип клиента", "Форма оплаты"],
    },
    {
      title: "Скидки и наценки",
      labels: ["Тип скидки", "Размер скидки", "Наценки"],
    },
    {
      title: "План",
      labels: ["Сумма плана", "Ретро-бонус"],
    },
  ];

  var TEAM_PLACEHOLDER_LABELS = ["Региональный менеджер", "Фурнитурный менеджер"];

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

  function pendingBlock(labels) {
    var list = labels
      .map(function (label) {
        return "<li>" + escapeHtml(label) + "</li>";
      })
      .join("");
    return (
      '<div class="legacy-pending-block">' +
      '<p class="legacy-pending-block__notice">' +
      escapeHtml(PENDING_NOTICE) +
      "</p>" +
      '<ul class="legacy-pending-block__labels">' +
      list +
      "</ul>" +
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
    var holdingHtml = "—";
    if (client.holding) {
      holdingHtml =
        esc(client.holding.name) +
        ' · <a class="clients-link clients-link--filter" href="/clients?holding=' +
        encodeURIComponent(client.holding.id) +
        '">' +
        esc(client.holding.id.slice(0, 8).toUpperCase()) +
        "</a>";
    }
    return (
      '<header class="client-detail-header">' +
      '<nav class="client-detail-breadcrumb" aria-label="Навигация">' +
      '<a class="clients-link" href="/clients' +
      esc(returnQuery) +
      '">Клиенты</a>' +
      '<span class="client-detail-breadcrumb__sep" aria-hidden="true">/</span>' +
      '<span class="client-detail-breadcrumb__current">' +
      esc(client.name) +
      "</span>" +
      "</nav>" +
      '<div class="client-detail-header__actions">' +
      '<a class="workspace-button workspace-button--ghost" href="/clients' +
      esc(returnQuery) +
      '">← К списку</a>' +
      "</div>" +
      '<h1 class="client-detail-header__title">' +
      esc(client.name) +
      "</h1>" +
      '<div class="client-detail-header__meta">' +
      '<span class="legacy-badge">' +
      esc(client.sourceLabel || "Данные из 1С") +
      "</span>" +
      '<span class="client-detail-header__holding">' +
      '<span class="client-detail-header__holding-label">Холдинг:</span> ' +
      holdingHtml +
      "</span>" +
      "</div>" +
      "</header>"
    );
  }

  function renderContactsSection() {
    return (
      openSection(
        "section-contacts",
        "Контакты",
        '<dl class="legacy-field-list">' +
          fieldRow("Фактический адрес", '<span id="client-address" class="client-detail-value"></span>') +
          '<div class="client-detail-copy-row">' +
          '<button type="button" id="copy-address" class="workspace-button workspace-button--secondary">Копировать адрес</button>' +
          '<p id="copy-address-status" class="workspace-status" role="status" aria-live="polite"></p>' +
          "</div>" +
          fieldRow("Телефоны", '<div id="client-phones" class="client-detail-phones"></div>') +
          "</dl>",
      )
    );
  }

  function renderRequisitesSection() {
    return collapsibleSection("section-requisites", "Реквизиты", pendingBlock(REQUISITES_LABELS), {
      expanded: false,
    });
  }

  function renderTeamSection(managerName, managerShortId, escapeFn) {
    var esc = escapeFn || escapeHtml;
    var managerValue = esc(dash(managerName)) + (managerShortId ? " · " + esc(managerShortId) : "");
    var body =
      '<dl class="legacy-field-list">' +
      fieldRow("Менеджер из 1С", managerValue) +
      TEAM_PLACEHOLDER_LABELS.map(function (label) {
        return fieldRow(label, '<span class="legacy-value-pending">' + esc(PENDING_NOTICE) + "</span>");
      }).join("") +
      "</dl>";
    return openSection("section-team", "Команда", body);
  }

  function renderCommercialSection() {
    var body = COMMERCIAL_GROUPS.map(function (group) {
      return (
        '<div class="legacy-subgroup">' +
        '<h3 class="legacy-subgroup__title">' +
        escapeHtml(group.title) +
        "</h3>" +
        pendingBlock(group.labels) +
        "</div>"
      );
    }).join("");
    return collapsibleSection("section-commercial", "Коммерческие условия", body, { expanded: false });
  }

  function renderStoresSection() {
    return openSection(
      "section-stores",
      "Торговые точки",
      '<p class="legacy-honest-empty">Торговые точки ещё не подключены</p>',
    );
  }

  function renderTechSection() {
    var body =
      '<dl class="legacy-field-list">' +
      fieldRow("UUID", '<span id="client-uuid" class="client-detail-uuid"></span>') +
      fieldRow(
        "Загрузка записи",
        '<span id="client-last-import" class="client-detail-value"></span>',
      ) +
      "</dl>";
    return collapsibleSection("section-tech", "Техническая информация", body, { expanded: false });
  }

  function renderAllSections(returnQuery) {
    return (
      renderHeader({ name: "", sourceLabel: "Данные из 1С", holding: null }, returnQuery) +
      '<div id="client-detail-sections" class="client-detail-sections">' +
      renderContactsSection() +
      renderRequisitesSection() +
      '<div id="client-team-section"></div>' +
      renderCommercialSection() +
      renderStoresSection() +
      renderTechSection() +
      "</div>"
    );
  }

  function mountTeamSection(container, client, escapeFn) {
    if (!container) {
      return;
    }
    container.innerHTML = renderTeamSection(
      client.manager ? client.manager.name : "",
      client.manager ? client.manager.shortId : "",
      escapeFn,
    );
  }

  function initCollapsibles(root) {
    if (!root) {
      return;
    }
    root.querySelectorAll(".legacy-details").forEach(function (details) {
      var summary = details.querySelector("summary");
      if (!summary) {
        return;
      }
      summary.setAttribute("role", "button");
      var setExpanded = function () {
        summary.setAttribute("aria-expanded", details.open ? "true" : "false");
      };
      setExpanded();
      details.addEventListener("toggle", setExpanded);
    });
  }

  var exported = {
    PENDING_NOTICE: PENDING_NOTICE,
    REQUISITES_LABELS: REQUISITES_LABELS,
    COMMERCIAL_GROUPS: COMMERCIAL_GROUPS,
    renderAllSections: renderAllSections,
    renderHeader: renderHeader,
    mountTeamSection: mountTeamSection,
    initCollapsibles: initCollapsibles,
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
