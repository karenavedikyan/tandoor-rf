(function () {
  "use strict";
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  window.OnecQuality = {
    render: function (quality) {
      if (!quality || !quality.issues || !quality.issues.length) return "";
      return '<details class="onec-quality"><summary>Требует проверки в 1С</summary><ul>' +
        quality.issues.map(function (issue) { return "<li>" + esc(issue.message) +
          (issue.field ? " <small>(" + esc(issue.field) + ")</small>" : "") + "</li>"; }).join("") +
        '</ul>' + (quality.variants && quality.variants.length ?
          '<p>Исходные варианты доступных полей (до 20 строк):</p>' +
          quality.variants.map(function (variant) { return '<div class="onec-report-row"><small>' + esc(variant.file) +
            ", строка " + esc(variant.row) + "</small><pre>" + esc(JSON.stringify(variant.values, null, 2)) + "</pre></div>"; }).join("") : "") +
        '<p>Исправления выполняются в 1С и появятся после следующего ручного обновления.</p></details>';
    }
  };
}());
