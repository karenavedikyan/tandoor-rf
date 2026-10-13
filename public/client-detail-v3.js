(function (root) {
  "use strict";

  function esc(shell, value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    return shell.escapeHtml(String(value));
  }

  function boolLabel(value) {
    if (value === true) return "Да";
    if (value === false) return "Нет";
    return "—";
  }

  function dlRow(label, valueHtml) {
    return "<dt>" + label + "</dt><dd>" + valueHtml + "</dd>";
  }

  function section(title, rowsHtml) {
    return '<section class="client-card-section"><h2>' + title + "</h2><dl>" + rowsHtml + "</dl></section>";
  }

  function formatManagersBlock(shell, managers) {
    if (!managers || typeof managers !== "object") {
      return "—";
    }
    var rows = [];
    if (managers.nameManager) rows.push(dlRow("Менеджер", esc(shell, managers.nameManager)));
    if (managers.nameRegionalManager) rows.push(dlRow("Региональный менеджер", esc(shell, managers.nameRegionalManager)));
    if (managers.nameHardwareManager) rows.push(dlRow("Менеджер фурнитуры", esc(shell, managers.nameHardwareManager)));
    if (managers.nameHeadOfSales) rows.push(dlRow("РОП", esc(shell, managers.nameHeadOfSales)));
    return rows.length ? rows.join("") : "—";
  }

  function formatTypeCategory(shell, tc) {
    if (!tc || typeof tc !== "object") return "—";
    var type = tc.nameType || tc.guidType || "";
    var cat = tc.nameCategory || tc.guidCategory || "";
    if (type && cat) return esc(shell, type + " / " + cat);
    return esc(shell, type || cat || "—");
  }

  function formatTelephones(shell, tel) {
    if (!Array.isArray(tel) || !tel.length) return "—";
    return tel.map(function (t) { return esc(shell, t); }).join(", ");
  }

  function formatMarkups(shell, markups) {
    if (!Array.isArray(markups) || !markups.length) return "—";
    return markups
      .map(function (m) {
        if (!m || typeof m !== "object") return "";
        return esc(shell, (m.name || "—") + (m.percentage != null ? " (" + m.percentage + "%)" : ""));
      })
      .filter(Boolean)
      .join("; ");
  }

  function formatOtherFields(shell, other) {
    if (!other || typeof other !== "object") return "—";
    return Object.keys(other)
      .map(function (k) {
        return esc(shell, k + ": " + other[k]);
      })
      .join("<br/>");
  }

  function formatLoading(shell, loading) {
    if (!loading || typeof loading !== "object") return "—";
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
      if (loading[keys[i][0]] === true || loading[keys[i][1]] === true) parts.push(days[i]);
    }
    var time = loading.loadingTime || loading.loading_time || "";
    var line = parts.length ? parts.join(", ") : "—";
    if (time) line += " · " + time;
    return esc(shell, line);
  }

  function formatContacts(shell, contacts) {
    if (!contacts || typeof contacts !== "object") return "—";
    var rows = [];
    if (contacts.store_phone || contacts.storePhone) {
      rows.push(dlRow("Телефон магазина", esc(shell, contacts.store_phone || contacts.storePhone)));
    }
    if (contacts.accountant_phone || contacts.accountantPhone) {
      rows.push(dlRow("Телефон бухгалтерии", esc(shell, contacts.accountant_phone || contacts.accountantPhone)));
    }
    if (contacts.accountant_email || contacts.accountantEmail) {
      rows.push(dlRow("Email бухгалтерии", esc(shell, contacts.accountant_email || contacts.accountantEmail)));
    }
    return rows.length ? "<dl>" + rows.join("") + "</dl>" : "—";
  }

  function formatLprBlock(shell, lpr) {
    if (!lpr || typeof lpr !== "object") return "—";
    var rows = [];
    if (lpr.name) rows.push(dlRow("ФИО", esc(shell, lpr.name)));
    if (lpr.post) rows.push(dlRow("Должность", esc(shell, lpr.post)));
    if (lpr.phone) rows.push(dlRow("Телефон", esc(shell, lpr.phone)));
    if (lpr.email) rows.push(dlRow("Email", esc(shell, lpr.email)));
    if (lpr.date_of_birth || lpr.dateOfBirth) {
      rows.push(dlRow("Дата рождения", esc(shell, lpr.date_of_birth || lpr.dateOfBirth)));
    }
    if (lpr.bonus) rows.push(dlRow("Бонус", esc(shell, lpr.bonus)));
    if (lpr.conditions_bonus || lpr.conditionsBonus) {
      rows.push(dlRow("Условия бонуса", esc(shell, lpr.conditions_bonus || lpr.conditionsBonus)));
    }
    return rows.length ? "<dl>" + rows.join("") + "</dl>" : "—";
  }

  function formatClub(shell, add) {
    if (!add || typeof add !== "object") return "—";
    var status = add.status_tandoor_club ?? add.statusTandoorClub;
    var bonus = add.bonus_tandoor_club ?? add.bonusTandoorClub;
    var parts = [];
    if (status != null && status !== "") parts.push("Статус: " + status);
    if (bonus != null && bonus !== "") parts.push("Бонус: " + bonus);
    return esc(shell, parts.join(" · ") || "—");
  }

  function metaBlock(shell, ent) {
    return section(
      "Источник",
      dlRow("Обновлено из 1С", esc(shell, ent.last_imported_at || "—")) +
        dlRow("SHA источника", esc(shell, ent.last_source_sha256 || "—")),
    );
  }

  function formatHoldingLink(shell, holdingLink) {
    if (!holdingLink) return "—";
    var ret = encodeURIComponent(window.location.pathname + window.location.search);
    return (
      '<a href="/clients/' +
      encodeURIComponent(holdingLink.guid) +
      "?v3Entity=holding&return=" +
      ret +
      '">' +
      esc(shell, holdingLink.name) +
      "</a>"
    );
  }

  function renderHolding(shell, ent) {
    return (
      section(
        "Холдинг",
        dlRow("Название", esc(shell, ent.name)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Розничная сеть", boolLabel(ent.retail_chain)) +
          dlRow("Группа холдинга", boolLabel(ent.holding_group)) +
          dlRow("Ответственные", formatManagersBlock(shell, ent.managers)),
      ) + metaBlock(shell, ent)
    );
  }

  function renderLegal(shell, ent, holdingLink) {
    return (
      section(
        "Юрлицо",
        dlRow("Название", esc(shell, ent.name_client || ent.name)) +
          dlRow("Адрес", esc(shell, ent.address || "—")) +
          dlRow("Телефоны", formatTelephones(shell, ent.telephone)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Ответственные", formatManagersBlock(shell, ent.managers)) +
          dlRow("Скидка", esc(shell, ent.discount ?? "—")) +
          dlRow("Сумма скидки", esc(shell, ent.discount_amount ?? "—")) +
          dlRow("Наценки", formatMarkups(shell, ent.markups)) +
          dlRow("Реквизиты", formatOtherFields(shell, ent.other_fields)) +
          dlRow("Холдинг", formatHoldingLink(shell, holdingLink)),
      ) + metaBlock(shell, ent)
    );
  }

  function renderRetail(shell, ent, holdingLink) {
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    var route = addr.direction_of_the_route || addr.directionOfTheRoute || "—";
    return (
      section(
        "Торговая точка",
        dlRow("Адрес магазина", esc(shell, addr.store_address || addr.storeAddress || "—")) +
          dlRow("Адрес доставки", esc(shell, addr.delivery_address || addr.deliveryAddress || "—")) +
          dlRow("Маршрут", esc(shell, route)) +
          dlRow("Склад", boolLabel(ent.warehouse)) +
          dlRow("Закрыта", boolLabel(ent.closed)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Приёмка", formatLoading(shell, ent.information_loading)) +
          dlRow("Контакты", formatContacts(shell, ent.contact_information)) +
          dlRow("ЛПР", formatLprBlock(shell, ent.lpr_information)) +
          dlRow("Tandoor Club", formatClub(shell, ent.additional_information)) +
          dlRow("Ответственные", formatManagersBlock(shell, ent.managers)) +
          dlRow("Холдинг", formatHoldingLink(shell, holdingLink)),
      ) + metaBlock(shell, ent)
    );
  }

  root.ClientDetailV3 = {
    renderBody: function (shell, entityType, ent, holdingLink) {
      if (entityType === "holding") return renderHolding(shell, ent);
      if (entityType === "legal") return renderLegal(shell, ent, holdingLink);
      return renderRetail(shell, ent, holdingLink);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
