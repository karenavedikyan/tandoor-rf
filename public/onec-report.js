(function () {
  "use strict";
  function esc(value) { var el = document.createElement("div"); el.textContent = String(value == null ? "" : value); return el.innerHTML; }
  window.OnecManualReport = { open: function (batch) {
    var dialog = document.createElement("dialog"), page = 1;
    dialog.setAttribute("aria-label", "Построчный отчёт обновления 1С");
    dialog.style.cssText = "width:min(900px,94vw);max-height:85vh;overflow:auto;padding:20px;border:1px solid #ddd;border-radius:12px";
    dialog.innerHTML = '<button type="button" data-close>Закрыть</button><h2>Исходные данные 1С</h2>' +
      '<p>Данные сохранены как получены. Исправления выполняются в 1С.</p><div role="status" data-status></div>' +
      '<div data-rows></div><button type="button" data-prev>Назад</button> <button type="button" data-next>Далее</button>';
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").onclick = function () { dialog.close(); };
    dialog.addEventListener("close", function () { dialog.remove(); });
    async function load() {
      var status = dialog.querySelector("[data-status]"), prev = dialog.querySelector("[data-prev]"), next = dialog.querySelector("[data-next]");
      prev.disabled = next.disabled = true; status.textContent = "Загрузка…";
      try {
        var res = await fetch("/api/admin/clients/onec-update/report?batch=" + encodeURIComponent(batch) + "&page=" + page,
          { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) throw new Error("report");
        var data = await res.json();
        status.textContent = "Страница " + page + ". Всего строк: " + data.total +
          ". Замечаний в комплекте: " + (data.batch ? data.batch.issue_count : 0);
        dialog.querySelector("[data-rows]").innerHTML = data.records.map(function (row) {
          var issues = data.issues.filter(function (issue) { return issue.file_key === row.file_key && issue.row_indices.indexOf(row.row_index) !== -1; });
          return '<details class="onec-report-row"><summary>' + esc(row.file_key) + ", строка " + (row.row_index + 1) +
            (issues.length ? ": требуется проверка" : "") + "</summary>" +
            (window.OnecQuality ? window.OnecQuality.render({ issues: issues }) : "") +
            "<pre>" + esc(JSON.stringify(row.record, null, 2)) + "</pre></details>";
        }).join("");
        prev.disabled = page <= 1; next.disabled = page * 100 >= data.total;
      } catch { status.textContent = "Не удалось загрузить отчёт. Закройте окно и повторите попытку."; }
    }
    dialog.querySelector("[data-prev]").onclick = function () { page--; void load(); };
    dialog.querySelector("[data-next]").onclick = function () { page++; void load(); };
    dialog.showModal(); void load();
  } };
}());
