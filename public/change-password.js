(function () {
  "use strict";

  var api = window.TandoorRf;
  var form = document.getElementById("change-password-form");
  var currentInput = document.getElementById("current-password");
  var newInput = document.getElementById("new-password");
  var confirmInput = document.getElementById("confirm-password");
  var submitButton = document.getElementById("change-password-button");
  var statusEl = document.getElementById("status-message");
  var submitting = false;

  if (!form || !currentInput || !newInput || !confirmInput || !submitButton || !api) {
    return;
  }

  var passwordToggles = Array.from(form.querySelectorAll("[data-password-toggle]"));
  function setPasswordVisible(button, visible) {
    var input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Скрыть" : "Показать";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", (visible ? "Скрыть " : "Показать ") + button.dataset.passwordLabel);
  }
  passwordToggles.forEach(function (button) {
    button.addEventListener("click", function () {
      var input = document.getElementById(button.dataset.passwordToggle);
      if (input) setPasswordVisible(button, input.type === "password");
    });
  });

  function redirectAfterChange(user) {
    window.location.href = window.ClientsShell && window.ClientsShell.canReadClients(user) ? "/clients" : "/profile";
  }

  api
    .apiRequest("/api/auth/me")
    .then(function (result) {
      if (result.response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (result.response.status !== 200 || !result.data || !result.data.user) {
        api.setStatus(statusEl, "Не удалось проверить сессию.", "error");
        return;
      }
      if (!result.data.user.mustChangePassword) {
        redirectAfterChange(result.data.user);
      }
    })
    .catch(function () {
      api.setStatus(statusEl, "Не удалось проверить сессию.", "error");
    });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (newInput.value !== confirmInput.value) {
      api.setStatus(statusEl, "Новый пароль и подтверждение не совпадают.", "error");
      return;
    }

    passwordToggles.forEach(function (button) { setPasswordVisible(button, false); });
    submitting = true;
    submitButton.disabled = true;
    api.setStatus(statusEl, "Сохранение…", "loading");

    api
      .apiRequest("/api/profile/change-password", {
        method: "POST",
        body: {
          currentPassword: currentInput.value,
          newPassword: newInput.value,
        },
      })
      .then(function (result) {
        if (result.response.status === 200 && result.data && result.data.user) {
          redirectAfterChange(result.data.user);
          return;
        }
        api.setStatus(
          statusEl,
          api.extractErrorMessage(result.data, "Не удалось сменить пароль."),
          "error",
        );
      })
      .catch(function (err) {
        api.setStatus(statusEl, api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000), "error");
      })
      .finally(function () {
        submitting = false;
        submitButton.disabled = false;
      });
  });
})();
