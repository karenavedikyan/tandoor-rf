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

  function formatManagers(managers) {
    if (!managers || typeof managers !== "object") {
      return "—";
    }
    var parts = [];
    if (managers.name_manager) parts.push("Менеджер: " + managers.name_manager);
    if (managers.name_regional_manager) parts.push("Региональный: " + managers.name_regional_manager);
    if (managers.name_hardware_manager) parts.push("Фурнитура: " + managers.name_hardware_manager);
    return parts.length ? parts.join("; ") : "—";
  }

  function formatTypeCategory(shell, tc) {
    if (!tc || typeof tc !== "object") return "—";
    var type = tc.name_type || tc.guid_type || "";
    var cat = tc.name_category || tc.guid_category || "";
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
      "loading_on_monday",
      "loading_on_tuesday",
      "loading_on_wednesday",
      "loading_on_thursday",
      "loading_on_friday",
      "loading_on_saturday",
      "loading_on_sunday",
    ];
    var parts = [];
    for (var i = 0; i < keys.length; i += 1) {
      if (loading[keys[i]] === true) parts.push(days[i]);
    }
    var time = loading.loading_time || "";
    var line = parts.length ? parts.join(", ") : "—";
    if (time) line += " · " + time;
    return esc(shell, line);
  }

  function formatLpr(shell, lpr) {
    if (!lpr || typeof lpr !== "object") return "—";
    var parts = [];
    if (lpr.name) parts.push(lpr.name);
    if (lpr.post) parts.push(lpr.post);
    if (lpr.phone) parts.push(lpr.phone);
    if (lpr.email) parts.push(lpr.email);
    return esc(shell, parts.join(" · ") || "—");
  }

  function metaBlock(shell, ent) {
    return section(
      "Источник",
      dlRow("Обновлено из 1С", esc(shell, ent.last_imported_at || "—")) +
        dlRow("SHA источника", esc(shell, ent.last_source_sha256 || "—")),
    );
  }

  function renderHolding(shell, ent) {
    return (
      section(
        "Холдинг",
        dlRow("Название", esc(shell, ent.name)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Retail chain", boolLabel(ent.retail_chain)) +
          dlRow("Holding group", boolLabel(ent.holding_group)) +
          dlRow("Ответственные", esc(shell, formatManagers(ent.managers))),
      ) + metaBlock(shell, ent)
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

  function renderLegal(shell, ent, holdingLink) {
    var holdingHtml = formatHoldingLink(shell, holdingLink);
    return (
      section(
        "Юрлицо",
        dlRow("Название", esc(shell, ent.name_client || ent.name)) +
          dlRow("Адрес", esc(shell, ent.address || "—")) +
          dlRow("Телефоны", formatTelephones(shell, ent.telephone)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Ответственные", esc(shell, formatManagers(ent.managers))) +
          dlRow("Discount", esc(shell, ent.discount ?? "—")) +
          dlRow("DiscountAmount", esc(shell, ent.discount_amount ?? "—")) +
          dlRow("Наценки", formatMarkups(shell, ent.markups)) +
          dlRow("Реквизиты", formatOtherFields(shell, ent.other_fields)) +
          dlRow("Холдинг", holdingHtml),
      ) + metaBlock(shell, ent)
    );
  }

  function renderRetail(shell, ent, holdingLink) {
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    var club =
      ent.additional_information && typeof ent.additional_information === "object"
        ? ent.additional_information.tandoor_club || ent.additional_information.TandoorClub
        : null;
    var holdingHtml = formatHoldingLink(shell, holdingLink);
    return (
      section(
        "Торговая точка",
        dlRow("Адрес магазина", esc(shell, addr.store_address || "—")) +
          dlRow("Адрес доставки", esc(shell, addr.delivery_address || "—")) +
          dlRow("Маршрут", esc(shell, addr.route_direction || "—")) +
          dlRow("Склад", boolLabel(ent.warehouse)) +
          dlRow("Закрыта", boolLabel(ent.closed)) +
          dlRow("Тип и категория", formatTypeCategory(shell, ent.type_category)) +
          dlRow("Приёмка", formatLoading(shell, ent.information_loading)) +
          dlRow("Контакты", esc(shell, JSON.stringify(ent.contact_information || {}))) +
          dlRow("ЛПР", formatLpr(shell, ent.lpr_information)) +
          dlRow("Tandoor Club", esc(shell, club != null ? String(club) : "—")) +
          dlRow("Ответственные", esc(shell, formatManagers(ent.managers))) +
          dlRow("Холдинг", holdingHtml),
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
