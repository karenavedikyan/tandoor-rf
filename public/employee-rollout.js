(function () {
  "use strict";
  var api = window.TandoorRf, pending = null, busy = false;
  var el = function (id) { return document.getElementById("rollout-" + id); };
  if (!el("prepare")) return;
  function status(message, kind) { api.setStatus(el("status"), message, kind); }
  function buttons() {
    el("prepare").disabled = busy || !!pending;
    el("cancel").disabled = busy || !pending;
    el("activate").disabled = busy || !pending || !el("confirm").checked;
  }
  async function request(path, body) {
    var r = await api.apiRequest("/api/admin/access/users/rollouts" + path,
      { method: body === undefined ? "GET" : "POST", body: body, timeoutMs: 120000 });
    if (!r.response.ok) throw new Error(api.extractErrorMessage(r.data, "Операция не выполнена."));
    return r.data;
  }
  el("file").addEventListener("change", async function () {
    if (busy || pending || !this.files[0]) return;
    try {
      var text = await this.files[0].text();
      var meta = text.match(/^<!-- tandoor-rollout:(.+) -->/);
      if (meta) {
        var saved = JSON.parse(meta[1]);
        var state = await request("/" + encodeURIComponent(saved.id));
        if (state.state !== "staged") throw new Error("Операция уже завершена или отменена.");
        pending = { id: saved.id, receipt: saved.receipt };
        el("summary").textContent = "Восстановлена подготовка на " + state.count + " сотрудников.";
        status("Подтвердите сохранение файла перед активацией.", "");
      } else {
        JSON.parse(text);
        el("plan").value = text;
        status("Список загружен. Действующие аккаунты пока не изменены.", "");
      }
    } catch (error) { status(error.message, "error"); }
    buttons();
  });
  el("prepare").addEventListener("click", async function () {
    if (busy || pending) return;
    var id;
    try {
      var plan = JSON.parse(el("plan").value);
      id = crypto.randomUUID();
      busy = true; buttons(); status("Подготавливаю конфиденциальный файл. Не закрывайте страницу.", "");
      await request("/schema", { confirm: true });
      var result = await request("", {
        id: id, basis: plan.basis, entries: plan.entries, confirmResetExisting: true,
      });
      pending = { id: result.id, receipt: result.receipt };
      var blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "Tandor-vremennye-dostupy-" + result.id + ".md";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      el("summary").textContent = "Сотрудников: " + result.count + ". Действующих аккаунтов: " + result.existing +
        ". Новых: " + (result.count - result.existing) + ". Пока ничего не активировано.";
      status("Сохраните скачанный файл. Передавайте каждому сотруднику только его собственную строку.", "success");
    } catch (error) {
      status(error.message + " Не повторяйте выдачу вслепую.", "error");
      if (id) {
        try {
          var check = await request("/" + id);
          if (check.state === "staged") {
            pending = { id: id, receipt: null };
            status("Файл не подтверждён. Отмените подготовку и создайте новый файл; аккаунты не изменены.", "error");
          }
        } catch (_) { /* No operation was staged. No existing password was changed. */ }
      }
    } finally { busy = false; buttons(); }
  });
  el("confirm").addEventListener("change", buttons);
  el("activate").addEventListener("click", async function () {
    if (busy || !pending || !pending.receipt || !el("confirm").checked) return;
    try {
      busy = true; buttons();
      var result = await request("/" + pending.id + "/activate", { receipt: pending.receipt });
      status("Доступы активированы: " + result.count + ". При первом входе требуется смена пароля.", "success");
      pending = null; el("confirm").checked = false; el("plan").value = "";
      el("summary").textContent = "Операция " + result.id + " завершена.";
    } catch (error) {
      status(error.message + " Сохраните файл: операция проверяет повторную активацию и не меняет пароли второй раз.", "error");
    } finally { busy = false; buttons(); }
  });
  el("cancel").addEventListener("click", async function () {
    if (busy || !pending) return;
    try {
      busy = true; buttons();
      await request("/" + pending.id + "/cancel", {});
      pending = null; el("confirm").checked = false;
      status("Подготовка отменена. Аккаунты и пароли не изменены; скачанный файл не действует.", "");
    } catch (error) { status(error.message, "error"); }
    finally { busy = false; buttons(); }
  });
})();
