(function () {
  "use strict";
  var api = window.TandoorRf;
  if (!api) return;
  var mode = document.getElementById("login-with-code");
  function applyMode() {
    var label = document.querySelector('label:has(#password) .field__label');
    var password = document.getElementById("password");
    if (label) label.textContent = mode.checked ? "Временный код из бота" : "Пароль";
    if (password) { password.value = ""; password.autocomplete = mode.checked ? "one-time-code" : "current-password"; }
    api.setStatus(document.getElementById("status-message"), "", "");
  }
  if (mode) mode.addEventListener("change", applyMode);
  function useCode(email) {
    if (!mode) return;
    mode.checked = true; applyMode();
    if (email) document.getElementById("email").value = email;
    document.getElementById("password").focus();
  }
  document.getElementById("use-recovery-code")?.addEventListener("click", function () {
    useCode(document.querySelector('#bot-recovery-request-form [name="email"]').value);
  });
  function bind(id, url) {
    var form = document.getElementById(id), busy = false;
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      busy = true;
      var button = form.querySelector('[type="submit"]'), status = form.querySelector('[role="status"]');
      button.disabled = true;
      var body = {};
      new FormData(form).forEach(function (value, key) { body[key] = String(value); });
      body.confirmed = !!form.querySelector('[name="confirmed"]:checked');
      api.setStatus(status, "Запрашиваем код…", "loading");
      api.apiRequest(url, { method: "POST", body: body }).then(function (r) {
        if (!r.response.ok) { api.setStatus(status, api.extractErrorMessage(r.data, "Не удалось запросить код."), "error"); return; }
        api.setStatus(status, r.data.message, "success");
        if (id === "bot-recovery-request-form") useCode(body.email);
      }).catch(function () {
        api.setStatus(status, "Ответ не получен. Проверьте выбранный бот. Не повторяйте запрос автоматически.", "error");
      }).finally(function () {
        var password = form.querySelector('[name="currentPassword"]');
        if (password) password.value = "";
        body = null; busy = false; button.disabled = false;
      });
    });
  }
  bind("employee-reset-form", "/api/admin/access/users/reset-password");
  bind("bot-recovery-request-form", "/api/auth/recover-password");
})();
